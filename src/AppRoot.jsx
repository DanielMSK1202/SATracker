import React, { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from './lib/supabaseClient';
import { AuthProvider, useAuth } from './auth/AuthContext';
import AuthScreen from './auth/AuthScreen';
import MigrationGate from './auth/MigrationPrompt';
import App, { LoadingScreen } from './SATTracker.jsx';

function ConfigMissingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Supabase isn't configured yet</h1>
        <p className="mt-2 text-sm text-slate-600">
          Set <code className="rounded bg-white px-1 py-0.5">VITE_SUPABASE_URL</code> and{' '}
          <code className="rounded bg-white px-1 py-0.5">VITE_SUPABASE_ANON_KEY</code> in a{' '}
          <code className="rounded bg-white px-1 py-0.5">.env.local</code> file at the project root, then restart the
          dev server. See README.md for the full setup steps.
        </p>
      </div>
    </div>
  );
}

function BlockedScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="max-w-md text-center">
        <h1 className="text-4xl font-bold text-rose-500 sm:text-5xl">You have been banned from this site.</h1>
        <p className="mt-4 text-sm text-slate-400">If you believe this is a mistake, contact the site owner.</p>
      </div>
    </div>
  );
}

// Checking is_blocked here is purely a frontend convenience so a blocked
// user sees a clear message instead of a wall of failed requests - it is
// NOT the real enforcement boundary. The actual boundary is server-side:
// every RLS policy and SECURITY DEFINER function independently rejects a
// blocked user's auth.uid() (see supabase/migrations/0006_admin_panel.sql),
// so even if this check were skipped or bypassed, nothing would actually
// work for a blocked account.
function useIsBlocked(user) {
  const [checked, setChecked] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!user) { setChecked(true); setBlocked(false); return; }
    let cancelled = false;
    setChecked(false);
    supabase
      .from('profiles')
      .select('is_blocked')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setBlocked(Boolean(data?.is_blocked));
        setChecked(true);
      })
      .catch(() => {
        if (cancelled) return;
        // If this lookup itself fails, fail open to the normal app - RLS
        // still protects every real read/write regardless.
        setBlocked(false);
        setChecked(true);
      });
    return () => { cancelled = true; };
  }, [user]);

  return { checked, blocked };
}

function Gate() {
  const { user, authLoading } = useAuth();
  const { checked, blocked } = useIsBlocked(user);
  if (authLoading) return <LoadingScreen />;
  if (!user) return <AuthScreen />;
  if (!checked) return <LoadingScreen />;
  if (blocked) return <BlockedScreen />;
  return (
    <MigrationGate user={user}>
      <App />
    </MigrationGate>
  );
}

export default function AppRoot() {
  if (!isSupabaseConfigured) return <ConfigMissingScreen />;
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
