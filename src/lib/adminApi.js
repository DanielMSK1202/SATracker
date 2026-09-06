import { supabase } from './supabaseClient';

/**
 * Calls the admin-only Vercel serverless routes under /api/admin/,
 * attaching the current user's Supabase access token - same pattern as
 * callApi() in src/lib/ai.js. The server independently verifies this
 * caller is the admin account (see api/admin/*.js and
 * supabase/migrations/0006_admin_panel.sql); nothing about "am I admin" is
 * ever sent from here, so this file being reachable in the bundle carries
 * no privilege by itself.
 */
async function callAdminApi(path, payload) {
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
    throw new Error('Could not reach the admin panel. Please try again shortly.');
  }

  let body = null;
  try { body = await res.json(); } catch (e) { /* non-JSON error page, fall through */ }

  if (!res.ok) {
    throw new Error(body?.error || 'Something went wrong.');
  }
  return body;
}

export function fetchAdminUsers(localDate) {
  return callAdminApi('/api/admin/users', { action: 'list', localDate });
}

export function toggleUserBlock(userId) {
  return callAdminApi('/api/admin/users', { action: 'toggle_block', userId });
}

export function fetchAdminQuestions(filters = {}) {
  return callAdminApi('/api/admin/questions', { action: 'list', filters });
}

export function deleteAdminQuestion(questionId) {
  return callAdminApi('/api/admin/questions', { action: 'delete', questionId });
}
