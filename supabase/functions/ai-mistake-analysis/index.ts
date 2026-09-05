import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedUser } from '../_shared/supabaseClient.ts';
import { callGroq } from '../_shared/groq.ts';
import { MISTAKE_ANALYSIS_SYSTEM_PROMPT } from '../_shared/prompts.ts';
import { validateMistakeAnalysis } from '../_shared/validate.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const { client, user, error: authError } = await getAuthenticatedUser(req);
  if (!user) return jsonResponse({ error: authError || 'Not authenticated' }, 401);

  let body = {};
  try { body = await req.json(); } catch (e) { /* ignore */ }
  const errorId = body?.errorId;
  const forceRefresh = Boolean(body?.forceRefresh);
  if (!errorId || typeof errorId !== 'string') return jsonResponse({ error: 'errorId is required' }, 400);

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
    if (!errorRow) return jsonResponse({ error: 'Mistake not found.' }, 404);

    const { data: cache } = await client
      .from('ai_mistake_analyses')
      .select('*')
      .eq('error_id', errorId)
      .maybeSingle();

    const isFresh = cache && new Date(cache.created_at) >= new Date(errorRow.updated_at);
    if (cache && isFresh && !forceRefresh) {
      return jsonResponse({ analysis: cache.analysis, cached: true, analyzedAt: cache.created_at, model: cache.model });
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
        return jsonResponse({
          analysis: cache.analysis, cached: true, stale: true, analyzedAt: cache.created_at, model: cache.model,
          warning: 'Could not refresh this explanation right now, showing the last saved version.',
        });
      }
      const friendly = groqErr?.code === 'missing_api_key'
        ? 'AI analysis is not configured yet. Please try again later.'
        : 'AI analysis is temporarily unavailable. Please try again shortly.';
      return jsonResponse({ error: friendly }, 502);
    }

    const analyzedAt = new Date().toISOString();
    const { error: upsertError } = await client.from('ai_mistake_analyses').upsert({
      error_id: errorId, user_id: user.id, analysis, model: model || '', created_at: analyzedAt,
    });
    if (upsertError) console.error('Failed to cache mistake analysis', upsertError.message);

    return jsonResponse({ analysis, cached: false, analyzedAt, model });
  } catch (err) {
    console.error('ai-mistake-analysis unexpected error', err?.message);
    return jsonResponse({ error: 'Something went wrong analyzing this mistake. Please try again.' }, 500);
  }
});
