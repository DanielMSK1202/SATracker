import { setCors } from './_lib/cors.js';
import { getAuthenticatedUser } from './_lib/supabaseClient.js';
import { callGemini } from './_lib/gemini.js';
import { PRACTICE_QUESTION_SYSTEM_PROMPT } from './_lib/prompts.js';
import { validatePracticeQuestion } from './_lib/validate.js';
import { DIFFICULTIES, SECTION_MATH, SECTION_RW } from './_lib/taxonomy.js';

// Max NEW Gemini generations per user per calendar day. Serving an existing
// pool question (the common case once the pool has some depth) never
// touches this - see claim_pool_question() in the 0005 migration.
const MAX_DAILY_GENERATIONS = 10;

// Question generation now runs on Gemini instead of Groq (api/ai-analysis.js
// and api/ai-mistake-analysis.js are unaffected and keep using groq.js
// exactly as before). Leaving maxTokens generous since, same as the old
// gpt-oss-20b, Gemini's own internal "thinking" (if the model does any)
// draws from this budget before it writes the actual JSON answer.
const PRACTICE_QUESTION_MAX_TOKENS = 3000;

// Flattens the DB row (metadata columns + a nested `question` jsonb blob)
// into a single object the frontend can use directly - stem/choices/
// correctChoiceId/explanation alongside id/section/domain/topic/difficulty,
// rather than making callers reach into a nested `question.question`.
function rowToQuestion(row) {
  const content = row.question || {};
  return {
    id: row.id,
    section: row.section,
    domain: row.domain,
    topic: row.topic,
    difficulty: row.difficulty,
    model: row.model || '',
    createdAt: row.created_at,
    stem: content.stem,
    choices: content.choices,
    correctChoiceId: content.correctChoiceId,
    explanation: content.explanation,
  };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { client, user, error: authError } = await getAuthenticatedUser(req);
  if (!user) { res.status(401).json({ error: authError || 'Not authenticated' }); return; }

  const errorId = req.body?.errorId;
  // The client's own local calendar date (YYYY-MM-DD) - this app has no
  // stored timezone, so (same as practice_tests.date/errors.date) the
  // client is the source of truth for "what day is it for this student",
  // used only to key the daily quota bucket, never to compute a streak or
  // score value.
  const localDate = req.body?.localDate;
  if (!errorId || typeof errorId !== 'string') { res.status(400).json({ error: 'errorId is required' }); return; }
  if (!localDate || typeof localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    res.status(400).json({ error: 'localDate (YYYY-MM-DD) is required' }); return;
  }

  try {
    // RLS scopes this to the caller's own row; a mismatched id just returns
    // no row rather than another user's mistake.
    const { data: errorRow, error: fetchErr } = await client
      .from('errors')
      .select('section, domain, topic, difficulty')
      .eq('id', errorId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!errorRow) { res.status(404).json({ error: 'Mistake not found.' }); return; }

    const { section, domain, topic, difficulty } = errorRow;
    if (![SECTION_MATH, SECTION_RW].includes(section) || !DIFFICULTIES.includes(difficulty) || !domain || !topic) {
      res.status(400).json({ error: 'This mistake is missing category data needed to generate a question.' });
      return;
    }

    async function quotaInfo() {
      const { data: used, error: quotaErr } = await client.rpc('practice_quota_status', { p_date: localDate });
      if (quotaErr) throw quotaErr;
      const usedCount = used || 0;
      return { used: usedCount, max: MAX_DAILY_GENERATIONS, remaining: Math.max(0, MAX_DAILY_GENERATIONS - usedCount) };
    }

    // 1) Serve an unseen pool question if one exists. Never touches Gemini,
    // never counts against the daily quota.
    const { data: claimed, error: claimErr } = await client.rpc('claim_pool_question', {
      p_section: section, p_domain: domain, p_topic: topic, p_difficulty: difficulty,
    });
    if (claimErr) throw claimErr;
    const claimedRow = Array.isArray(claimed) ? claimed[0] : claimed;
    if (claimedRow) {
      res.status(200).json({ question: rowToQuestion(claimedRow), source: 'pool', quota: await quotaInfo() });
      return;
    }

    // 2) No unseen pool question - check (and atomically reserve) today's
    // quota before calling Gemini at all.
    const { data: newCount, error: quotaBumpErr } = await client.rpc('bump_practice_quota', {
      p_date: localDate, p_max: MAX_DAILY_GENERATIONS,
    });
    if (quotaBumpErr) throw quotaBumpErr;

    if (newCount == null) {
      // Quota exhausted for today. Fall back to ANY pool question for this
      // category (even one this user has already seen) rather than a bare
      // error, so there's still something to practice with when possible.
      const { data: fallback, error: fallbackErr } = await client.rpc('any_pool_question', {
        p_section: section, p_domain: domain, p_topic: topic, p_difficulty: difficulty,
      });
      if (fallbackErr) throw fallbackErr;
      const fallbackRow = Array.isArray(fallback) ? fallback[0] : fallback;
      const quota = { used: MAX_DAILY_GENERATIONS, max: MAX_DAILY_GENERATIONS, remaining: 0 };
      if (fallbackRow) {
        res.status(200).json({
          question: rowToQuestion(fallbackRow), source: 'fallback', quota,
          message: "You've used all your new practice questions for today - here's one you may have seen before. New ones unlock again tomorrow.",
        });
        return;
      }
      res.status(200).json({
        question: null, source: 'none', quota,
        message: "You're out of practice questions for today. Try again tomorrow.",
      });
      return;
    }

    // 3) Quota available and reserved - generate one new question with Gemini.
    let validated;
    let model = null;
    try {
      const { parsed, model: usedModel } = await callGemini({
        systemPrompt: PRACTICE_QUESTION_SYSTEM_PROMPT,
        userContent: JSON.stringify({ section, domain, topic, difficulty }),
        maxTokens: PRACTICE_QUESTION_MAX_TOKENS,
      });
      validated = validatePracticeQuestion(parsed, { section, domain, topic, difficulty });
      model = usedModel;
    } catch (genErr) {
      console.error('Gemini practice-question generation failed', genErr?.code, genErr?.message);
      // The quota slot was already spent for this attempt (matches the
      // existing ai-analysis.js "attempt" semantics: a failed try still
      // counts, so retries can't be used to bypass the limit). Fall back to
      // any pool question for this category if one exists.
      const { data: fallback } = await client.rpc('any_pool_question', {
        p_section: section, p_domain: domain, p_topic: topic, p_difficulty: difficulty,
      });
      const fallbackRow = Array.isArray(fallback) ? fallback[0] : fallback;
      const quota = await quotaInfo();
      if (fallbackRow) {
        res.status(200).json({
          question: rowToQuestion(fallbackRow), source: 'fallback', quota,
          warning: 'Could not generate a new question right now, showing a similar one instead.',
        });
        return;
      }
      const friendly = genErr?.code === 'missing_api_key'
        ? 'Practice questions are not configured yet. Please try again later.'
        : 'Could not generate a practice question right now. Please try again shortly.';
      res.status(502).json({ error: friendly, quota });
      return;
    }

    // The `question` jsonb column stores only the question content itself -
    // section/domain/topic/difficulty already live in their own columns, so
    // we don't duplicate them inside the jsonb blob.
    const { section: _s, domain: _d, topic: _t, difficulty: _diff, ...questionContent } = validated;
    const { data: inserted, error: insertErr } = await client.rpc('insert_generated_question', {
      p_section: section, p_domain: domain, p_topic: topic, p_difficulty: difficulty,
      p_question: questionContent, p_model: model || '',
    });
    if (insertErr) throw insertErr;
    const insertedRow = Array.isArray(inserted) ? inserted[0] : inserted;

    res.status(200).json({
      question: insertedRow
        ? rowToQuestion(insertedRow)
        : { id: null, section, domain, topic, difficulty, model, createdAt: new Date().toISOString(), ...questionContent },
      source: 'generated',
      quota: await quotaInfo(),
    });
  } catch (err) {
    console.error('practice-question unexpected error', err?.message);
    res.status(500).json({ error: 'Something went wrong getting a practice question. Please try again.' });
  }
}
