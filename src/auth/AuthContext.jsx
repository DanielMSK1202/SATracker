import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    let mounted = true;

    // Restores a persisted session on load (localStorage-backed by the
    // Supabase client itself), so refreshing the page keeps you signed in.
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setAuthError(error.message);
      setSession(data.session);
      setAuthLoading(false);
    });

    // Keeps session state in sync across sign-in, sign-out, and token refresh
    // (including when a session expires and Supabase clears it automatically).
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(async (email, password) => {
    setAuthError(null);
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) { setAuthError(error.message); throw error; }
  }, []);

  const signIn = useCallback(async (email, password) => {
    setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setAuthError(error.message); throw error; }
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('Sign out failed', error);
  }, []);

  const value = {
    session,
    user: session?.user || null,
    authLoading,
    authError,
    setAuthError,
    signUp,
    signIn,
    signOut,
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
