import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  // Fails loudly in the console instead of silently sending requests to `undefined`.
  console.error(
    'Missing Supabase environment variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY ' +
    'in a .env.local file (see .env.example) and restart the dev server.',
  );
}

// A single shared client. Supabase's client manages the auth session (storage,
// refresh) internally and attaches the current user's access token to every
// query automatically, which is what makes the Row Level Security policies
// on each table see the correct auth.uid().
export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
