import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import { Button, Card, Field, inputCls, ThemeCtx, lightTokens, SERIF } from '../shared/ui.jsx';

export default function AuthScreen() {
  const { signIn, signUp, authError, setAuthError } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState('');

  async function submit(e) {
    e.preventDefault();
    setInfo('');
    setAuthError(null);
    if (!email.trim() || !password) { setAuthError('Enter an email and password.'); return; }
    if (mode === 'signup' && password.length < 6) { setAuthError('Password must be at least 6 characters.'); return; }
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password);
        setInfo('Account created. If email confirmation is on, check your inbox, then log in below.');
        setMode('login');
        setPassword('');
      }
    } catch (err) {
      // authError is already set by the auth context.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ThemeCtx.Provider value={lightTokens}>
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <div className="text-2xl font-semibold text-slate-900" style={SERIF}>Scorebook</div>
            <div className="mt-1 text-sm text-slate-500">Digital SAT tracker</div>
          </div>
          <Card title={mode === 'login' ? 'Log in' : 'Create an account'}>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Email">
                <input
                  type="email"
                  autoComplete="email"
                  className={inputCls(lightTokens)}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </Field>
              <Field label="Password" hint={mode === 'signup' ? 'At least 6 characters' : undefined}>
                <input
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  className={inputCls(lightTokens)}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="********"
                />
              </Field>
              {authError && <p className="text-sm text-rose-600">{authError}</p>}
              {info && <p className="text-sm text-emerald-600">{info}</p>}
              <Button type="submit" className="w-full justify-center" disabled={submitting}>
                {submitting ? 'Please wait...' : mode === 'login' ? 'Log in' : 'Sign up'}
              </Button>
            </form>
          </Card>
          <p className="mt-4 text-center text-sm text-slate-500">
            {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
            <button
              type="button"
              className="font-medium text-amber-700 hover:underline"
              onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setAuthError(null); setInfo(''); }}
            >
              {mode === 'login' ? 'Sign up' : 'Log in'}
            </button>
          </p>
        </div>
      </div>
    </ThemeCtx.Provider>
  );
}
