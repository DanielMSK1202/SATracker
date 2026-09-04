import React from 'react';
import { isSupabaseConfigured } from './lib/supabaseClient';
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

function Gate() {
  const { user, authLoading } = useAuth();
  if (authLoading) return <LoadingScreen />;
  if (!user) return <AuthScreen />;
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
