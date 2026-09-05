import { supabase } from './supabaseClient';

/**
 * Calls our own Vercel serverless functions under /api/, attaching the
 * current user's Supabase access token so the function can verify who is
 * calling (server-side, via the Authorization header) - nothing about
 * "who this is" is ever sent in the request body, and the Groq API key
 * never touches the browser.
 */
async function callApi(path, payload) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Your session has expired. Please sign in again.');
  }

  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error('AI analysis is temporarily unavailable. Please try again shortly.');
  }

  let body = null;
  try { body = await res.json(); } catch (e) { /* non-JSON error page, fall through */ }

  if (!res.ok) {
    throw new Error(body?.error || 'AI analysis is temporarily unavailable. Please try again shortly.');
  }
  return body;
}

export function fetchPerformanceAnalysis(forceRefresh = false) {
  return callApi('/api/ai-analysis', { forceRefresh });
}

export function analyzeMistake(errorId, forceRefresh = false) {
  return callApi('/api/ai-mistake-analysis', { errorId, forceRefresh });
}

// localDate is the caller's own local calendar date (YYYY-MM-DD, see
// todayIso() in SATTracker.jsx) - used only to key the per-day quota
// bucket server-side, the same client-supplied-local-date pattern already
// used for practice_tests.date/errors.date.
export function requestPracticeQuestion(errorId, localDate) {
  return callApi('/api/practice-question', { errorId, localDate });
}
