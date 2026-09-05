import { setCors } from './_lib/cors.js';
import { getAuthenticatedUser } from './_lib/supabaseClient.js';
import { callGroq } from './_lib/groq.js';
import { MISTAKE_ANALYSIS_SYSTEM_PROMPT } from './_lib/prompts.js';
import { validateMistakeAnalysis } from './_lib/validate.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { client, user, error: authError } = await getAuthenticatedUser(req);
  if (!user) { res.status(401).json({ error: authError || 'Not authenticated' }); return; }

  const errorId = req.body?.errorId;
  const forceRefresh = Boolean(req.body?.forceRefresh);
  if (!errorId || typeof errorId !== 'string') { res.status(400).json({ error: 'errorId is required' }); return; }

  try {
    // RLS scopes this to the caller's own row; a mismatched id just returns
    // no row rather than another user's data.
    const { data: errorRow, error: fetchErr } = await client
      .from('errors')
      .select('*')
      .eq('id', errorId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!errorRow) { res.status(404).json({ error: 'Mistake not found.' }); return; }

    const { data: cache } = await client
      .from('ai_mistake_analyses')
      .select('*')
      .eq('error_id', errorId)
      .maybeSingle();

    const isFresh = cache && new Date(cache.created_at) >= new Date(errorRow.updated_at);
    if (cache && isFresh && !forceRefresh) {
      res.status(200).json({ analysis: cache.analysis, cached: true, analyzedAt: cache.created_at, model: cache.model });
      return;
    }

    const { data: relatedRows } = await client
      .from('errors')
      .select('date, description, reason, status')
      .eq('user_id', user.id)
      .eq('domain', errorRow.domain)
      .eq('topic', errorRow.topic)
      .eq('section', errorRow.section)
      .neq('id', errorId)
      .order('date', { ascending: false })
      .limit(5);

    const context = {
      mistake: {
        section: errorRow.section,
        domain: errorRow.domain,
        topic: errorRow.topic,
        difficulty: errorRow.difficulty,
        description: errorRow.description || '',
        reasonSelectedByStudent: errorRow.reason,
        studentsCorrectApproachNotes: errorRow.explanation || '',
        status: errorRow.status,
      },
      relatedMistakesSameTopic: (relatedRows || []).map((r) => ({
        date: r.date, description: r.description, reason: r.reason, status: r.status,
      })),
    };

    let analysis;
    let model = null;
    try {
      const { parsed, model: usedModel } = await callGroq({
        systemPrompt: MISTAKE_ANALYSIS_SYSTEM_PROMPT,
        userContent: JSON.stringify(context),
        maxTokens: 900,
      });
      analysis = validateMistakeAnalysis(parsed);
      model = usedModel;
    } catch (groqErr) {
      console.error('Groq mistake analysis failed', groqErr?.code, groqErr?.message);
      if (cache) {
        res.status(200).json({
          analysis: cache.analysis, cached: true, stale: true, analyzedAt: cache.created_at, model: cache.model,
          warning: 'Could not refresh this explanation right now, showing the last saved version.',
        });
        return;
      }
      const friendly = groqErr?.code === 'missing_api_key'
        ? 'AI analysis is not configured yet. Please try again later.'
        : 'AI analysis is temporarily unavailable. Please try again shortly.';
      res.status(502).json({ error: friendly });
      return;
    }

    const analyzedAt = new Date().toISOString();
    const { error: upsertError } = await client.from('ai_mistake_analyses').upsert({
      error_id: errorId, user_id: user.id, analysis, model: model || '', created_at: analyzedAt,
    });
    if (upsertError) console.error('Failed to cache mistake analysis', upsertError.message);

    res.status(200).json({ analysis, cached: false, analyzedAt, model });
  } catch (err) {
    console.error('ai-mistake-analysis unexpected error', err?.message);
    res.status(500).json({ error: 'Something went wrong analyzing this mistake. Please try again.' });
  }
}
