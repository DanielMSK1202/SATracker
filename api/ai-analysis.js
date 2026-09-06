import { setCors } from './_lib/cors.js';
import { getAuthenticatedUser } from './_lib/supabaseClient.js';
import { buildPerformanceProfile, computeFingerprint } from './_lib/analytics.js';
import { callGroq } from './_lib/groq.js';
import { GLOBAL_ANALYSIS_SYSTEM_PROMPT } from './_lib/prompts.js';
import { validateGlobalAnalysis } from './_lib/validate.js';

// Minimum time between actual Groq calls for a given user's global analysis,
// even when the underlying data has changed. Protects against a burst of
// edits or repeated "Try again" clicks after a failure from each triggering
// their own Groq call.
const ATTEMPT_COOLDOWN_MS = 30_000;

function rowToTest(row) {
  return { id: row.id, name: row.name, date: row.date, mathScore: row.math_score, rwScore: row.rw_score, totalScore: row.total_score, notes: row.notes || '' };
}
function rowToError(row) {
  return {
    id: row.id, testId: row.test_id, date: row.date, section: row.section, domain: row.domain, topic: row.topic,
    description: row.description || '', reason: row.reason, explanation: row.explanation || '',
    difficulty: row.difficulty, status: row.status,
  };
}
function emptyAnalysis(summary) {
  return {
    overallAssessment: { summary, confidence: 'low' },
    strengths: [], weaknesses: [], recurringPatterns: [], improvement: [], studyPriorities: [], testStrategy: [],
  };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { client, user, error: authError, blocked } = await getAuthenticatedUser(req);
  if (!user) { res.status(blocked ? 403 : 401).json({ error: authError || 'Not authenticated' }); return; }

  const attemptId = `profile:${user.id}`;

  try {
    const [testsRes, errorsRes, goalsRes, settingsRes, profileRes, cacheRes, attemptRes] = await Promise.all([
      client.from('practice_tests').select('*').eq('user_id', user.id),
      client.from('errors').select('*').eq('user_id', user.id),
      client.from('goals').select('*').eq('user_id', user.id).maybeSingle(),
      client.from('settings').select('*').eq('user_id', user.id).maybeSingle(),
      client.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      client.from('ai_analyses').select('*').eq('user_id', user.id).maybeSingle(),
      client.from('ai_analysis_attempts').select('*').eq('id', attemptId).maybeSingle(),
    ]);

    if (testsRes.error) throw testsRes.error;
    if (errorsRes.error) throw errorsRes.error;

    const tests = (testsRes.data || []).map(rowToTest);
    const errors = (errorsRes.data || []).map(rowToError);
    const config = {
      targetTotal: goalsRes.data?.target_total ?? 1400,
      targetMath: goalsRes.data?.target_math ?? 700,
      targetRW: goalsRes.data?.target_rw ?? 700,
      theme: settingsRes.data?.theme ?? 'light',
      userName: profileRes.data?.display_name ?? '',
    };
    const cache = cacheRes.data || null;
    const lastAttempt = attemptRes.data || null;
    const fingerprint = computeFingerprint(tests, errors, config);

    // Nothing has changed since the last analysis (no new/edited test or
    // error, no changed goals) - always serve the cache. This is what
    // actually stops "Refresh analysis" from burning Groq quota: refreshing
    // only ever calls Groq again once there's new data to analyze.
    if (cache && cache.fingerprint === fingerprint) {
      res.status(200).json({
        analysis: cache.analysis, profile: cache.profile, cached: true, upToDate: true,
        analyzedAt: cache.created_at, model: cache.model,
      });
      return;
    }

    // Data did change (or there's no cache yet) - but still throttle how
    // often we'll actually call Groq, so a Groq outage (or someone mashing
    // "Try again" while it's down) can't spam the API either.
    const msSinceLastAttempt = lastAttempt
      ? Date.now() - new Date(lastAttempt.last_attempted_at).getTime()
      : Infinity;
    if (msSinceLastAttempt < ATTEMPT_COOLDOWN_MS) {
      if (cache) {
        res.status(200).json({
          analysis: cache.analysis, profile: cache.profile, cached: true, stale: true,
          analyzedAt: cache.created_at, model: cache.model,
          warning: 'Please wait a moment before refreshing again.',
        });
        return;
      }
      res.status(429).json({ error: 'Please wait a moment before trying again.' });
      return;
    }

    await client.from('ai_analysis_attempts').upsert({
      id: attemptId, user_id: user.id, last_attempted_at: new Date().toISOString(),
    });

    const profile = buildPerformanceProfile(tests, errors, cache?.profile || null);

    let analysis;
    let model = null;

    if (profile.dataMaturity === 'none') {
      analysis = emptyAnalysis('Complete your first test to start building your performance profile.');
    } else {
      try {
        const { parsed, model: usedModel } = await callGroq({
          systemPrompt: GLOBAL_ANALYSIS_SYSTEM_PROMPT,
          userContent: JSON.stringify(profile),
          maxTokens: 2200,
        });
        analysis = validateGlobalAnalysis(parsed, profile);
        model = usedModel;
      } catch (groqErr) {
        console.error('Groq analysis failed', groqErr?.code, groqErr?.message);
        if (cache) {
          res.status(200).json({
            analysis: cache.analysis, profile: cache.profile, cached: true, stale: true,
            analyzedAt: cache.created_at, model: cache.model,
            warning: 'Could not refresh your analysis right now, showing your last saved analysis.',
          });
          return;
        }
        const friendly = groqErr?.code === 'missing_api_key'
          ? 'AI analysis is not configured yet. Please try again later.'
          : 'AI analysis is temporarily unavailable. Please try again shortly.';
        res.status(502).json({ error: friendly });
        return;
      }
    }

    const analyzedAt = new Date().toISOString();
    const { error: upsertError } = await client.from('ai_analyses').upsert({
      user_id: user.id, fingerprint, profile, analysis, model: model || '', created_at: analyzedAt,
    });
    if (upsertError) console.error('Failed to cache analysis', upsertError.message);

    res.status(200).json({ analysis, profile, cached: false, analyzedAt, model });
  } catch (err) {
    console.error('ai-analysis unexpected error', err?.message);
    res.status(500).json({ error: 'Something went wrong loading your analysis. Please try again.' });
  }
}
