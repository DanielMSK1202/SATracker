import { setCors } from '../_lib/cors.js';
import { getAuthenticatedUser } from '../_lib/supabaseClient.js';
import { MAX_DAILY_GENERATIONS } from '../_lib/config.js';

// Flattens a row from admin_list_users() into the shape the frontend uses.
function rowToUser(row) {
  return {
    id: row.id,
    displayName: row.display_name || '',
    createdAt: row.created_at,
    isBlocked: row.is_blocked,
    practiceTestCount: row.practice_test_count,
    errorCount: row.error_count,
    currentStreak: row.current_streak,
    quotaUsed: row.quota_used,
    quotaMax: MAX_DAILY_GENERATIONS,
  };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // Check #1: a valid, non-blocked, authenticated Supabase session.
  const { client, user, error: authError, blocked } = await getAuthenticatedUser(req);
  if (!user) { res.status(blocked ? 403 : 401).json({ error: authError || 'Not authenticated' }); return; }

  // Check #2: the caller's real id (from their verified JWT, never anything
  // the request body claims) must match the admin uid from our own env var.
  // This is fully independent of check #3 below - neither check alone is
  // trusted as sufficient.
  if (!process.env.ADMIN_USER_ID || user.id !== process.env.ADMIN_USER_ID) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const action = req.body?.action;

  try {
    // Check #3: admin_list_users()/admin_toggle_user_blocked() independently
    // re-verify auth.uid() against the hardcoded admin uid inside Postgres
    // (see supabase/migrations/0006_admin_panel.sql) and raise if it doesn't
    // match - this call would fail even if checks #1/#2 above were somehow
    // bypassed.
    if (action === 'list') {
      const localDate = req.body?.localDate;
      const params = localDate && /^\d{4}-\d{2}-\d{2}$/.test(localDate) ? { p_quota_date: localDate } : {};
      const { data, error } = await client.rpc('admin_list_users', params);
      if (error) throw error;
      res.status(200).json({ users: (data || []).map(rowToUser) });
      return;
    }

    if (action === 'toggle_block') {
      const userId = req.body?.userId;
      if (!userId || typeof userId !== 'string') { res.status(400).json({ error: 'userId is required' }); return; }
      const { data, error } = await client.rpc('admin_toggle_user_blocked', { p_user_id: userId });
      if (error) throw error;
      res.status(200).json({ isBlocked: data });
      return;
    }

    res.status(400).json({ error: 'Unknown or missing action.' });
  } catch (err) {
    console.error('admin/users unexpected error', err?.message);
    const message = /admin account cannot be blocked|not found/i.test(err?.message || '')
      ? err.message
      : 'Something went wrong loading admin data.';
    res.status(500).json({ error: message });
  }
}
