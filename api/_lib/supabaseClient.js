import { createClient } from '@supabase/supabase-js';

/**
 * Creates a Supabase client scoped to the calling user's own access token
 * (forwarded from the Authorization header the frontend sends). This
 * deliberately uses the ANON key, not the service role key: every query
 * this client makes is still subject to Row Level Security, so even a bug
 * in this function's code cannot leak another user's rows. The user's
 * identity always comes from the verified JWT, never from anything the
 * client sent in the request body.
 */
export function createUserScopedClient(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader) return { client: null };
  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: authHeader } } },
  );
  return { client };
}

/**
 * Verifies the request's JWT and returns the authenticated user, or null if
 * the token is missing/invalid/expired. Never trusts a client-supplied user id.
 *
 * Also rejects users whose profiles.is_blocked flag is set, so every api/
 * route that calls this (which is all of them) gets blocking enforcement for
 * free without repeating the check in each file. This is a fast-fail
 * convenience layer, NOT the real backstop against a blocked user reaching
 * data: the RLS policies and SECURITY DEFINER functions in
 * supabase/migrations/0006_admin_panel.sql enforce the same thing
 * independently and are what actually stop a blocked user's Supabase client
 * from reading/writing anything directly (which most of this app's CRUD
 * does, bypassing api/ entirely).
 */
export async function getAuthenticatedUser(req) {
  const { client } = createUserScopedClient(req);
  if (!client) return { client: null, user: null, error: 'Missing Authorization header' };
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    return { client, user: null, error: error?.message || 'Invalid or expired session', blocked: false };
  }

  const { data: profile } = await client
    .from('profiles')
    .select('is_blocked')
    .eq('id', data.user.id)
    .maybeSingle();

  if (profile?.is_blocked) {
    return { client, user: null, error: 'Your account has been blocked.', blocked: true };
  }

  return { client, user: data.user, error: null, blocked: false };
}
