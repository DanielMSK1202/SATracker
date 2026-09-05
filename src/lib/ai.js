import { supabase } from './supabaseClient';

/**
 * Thin wrappers around supabase.functions.invoke. The Supabase client
 * automatically attaches the current user's access token as the
 * Authorization header, which the edge functions use to identify the user
 * server-side - nothing about "who this is" is ever sent in the request
 * body, and the Groq API key never touches the browser.
 */

async function invoke(name, payload) {
  const { data, error } = await supabase.functions.invoke(name, { body: payload });
  if (error) {
    // supabase-js puts a parsed error body on error.context when available;
    // fall back to a generic message otherwise so nothing internal leaks.
    let message = 'AI analysis is temporarily unavailable. Please try again shortly.';
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch (e) { /* keep generic message */ }
    const wrapped = new Error(message);
    throw wrapped;
  }
  return data;
}

export function fetchPerformanceAnalysis(forceRefresh = false) {
  return invoke('ai-analysis', { forceRefresh });
}

export function analyzeMistake(errorId, forceRefresh = false) {
  return invoke('ai-mistake-analysis', { errorId, forceRefresh });
}
