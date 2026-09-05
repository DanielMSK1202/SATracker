import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Creates a Supabase client scoped to the calling user's own access token
 * (forwarded from the Authorization header the browser sent when invoking
 * this function). This deliberately uses the ANON key, not the service role
 * key: every query this client makes is still subject to Row Level Security,
 * so even a bug in this function's code cannot leak another user's rows.
 * The user's identity always comes from the verified JWT, never from
 * anything the client sent in the request body.
 */
export function createUserScopedClient(req) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return { client: null, authHeader: null };
  }
  const client = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_ANON_KEY'),
    { global: { headers: { Authorization: authHeader } } },
  );
  return { client, authHeader };
}

/**
 * Verifies the request's JWT and returns the authenticated user, or null if
 * the token is missing/invalid/expired. Never trusts a client-supplied user id.
 */
export async function getAuthenticatedUser(req) {
  const { client } = createUserScopedClient(req);
  if (!client) return { client: null, user: null, error: 'Missing Authorization header' };
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    return { client, user: null, error: error?.message || 'Invalid or expired session' };
  }
  return { client, user: data.user, error: null };
}
