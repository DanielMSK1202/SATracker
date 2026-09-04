import React, { useEffect, useState } from 'react';
import { storage } from '../utils/storage';
import * as db from '../lib/db';
import {
  Button, Card, ThemeCtx, lightTokens, SERIF,
  K, sanitizeTests, sanitizeErrors, sanitizeConfig, LoadingScreen,
} from '../SATTracker.jsx';

function migrationFlagKey(userId) { return `scorebook:migration:${userId}`; }

async function readLocalData() {
  const [testsR, errorsR, configR] = await Promise.allSettled([
    storage.get(K.TESTS),
    storage.get(K.ERRORS),
    storage.get(K.CONFIG),
  ]);
  let localTests = [];
  let localErrors = [];
  let localConfig = null;
  try { localTests = sanitizeTests(testsR.status === 'fulfilled' ? JSON.parse(testsR.value.value) : []); } catch (e) { localTests = []; }
  try { localErrors = sanitizeErrors(errorsR.status === 'fulfilled' ? JSON.parse(errorsR.value.value) : [], new Set(localTests.map((t) => t.id))); } catch (e) { localErrors = []; }
  try { localConfig = configR.status === 'fulfilled' ? sanitizeConfig(JSON.parse(configR.value.value)) : null; } catch (e) { localConfig = null; }
  return { tests: localTests, errors: localErrors, config: localConfig };
}

/**
 * Gate rendered right after login, before the main app. Checks this browser's
 * localStorage for data left over from the pre-Supabase (V1.1) version of the
 * app. If found, and this user hasn't been asked before, offers to import it
 * into their new cloud account rather than silently discarding or overwriting
 * anything. The original localStorage data is left untouched either way.
 */
export default function MigrationGate({ user, children }) {
  const [status, setStatus] = useState('checking'); // checking | prompt | migrating | done
  const [localPreview, setLocalPreview] = useState(null);
  const [migrateError, setMigrateError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      let alreadyHandled = false;
      try { alreadyHandled = window.localStorage.getItem(migrationFlagKey(user.id)) !== null; } catch (e) { alreadyHandled = false; }
      if (alreadyHandled) { if (!cancelled) setStatus('done'); return; }

      const local = await readLocalData();
      if (cancelled) return;
      if (local.tests.length === 0 && local.errors.length === 0) {
        try { window.localStorage.setItem(migrationFlagKey(user.id), 'skipped-empty'); } catch (e) { /* ignore */ }
        setStatus('done');
        return;
      }
      setLocalPreview(local);
      setStatus('prompt');
    }
    check();
    return () => { cancelled = true; };
  }, [user.id]);

  async function handleImport() {
    setStatus('migrating');
    setMigrateError(null);
    try {
      await db.bulkImportTestsAndErrors(user.id, localPreview.tests, localPreview.errors, { replace: false });
      if (localPreview.config) {
        await Promise.all([
          db.updateProfile(user.id, localPreview.config.userName),
          db.updateSettings(user.id, localPreview.config.theme),
          db.updateGoals(user.id, {
            targetTotal: localPreview.config.targetTotal,
            targetMath: localPreview.config.targetMath,
            targetRW: localPreview.config.targetRW,
          }),
        ]);
      }
      try { window.localStorage.setItem(migrationFlagKey(user.id), 'imported'); } catch (e) { /* ignore */ }
      setStatus('done');
    } catch (err) {
      console.error('Migration failed', err);
      setMigrateError('Something went wrong importing your data. Check your connection and try again.');
      setStatus('prompt');
    }
  }

  function handleSkip() {
    try { window.localStorage.setItem(migrationFlagKey(user.id), 'skipped'); } catch (e) { /* ignore */ }
    setStatus('done');
  }

  if (status === 'checking') return <LoadingScreen />;

  if (status === 'prompt' || status === 'migrating') {
    const testCount = localPreview.tests.length;
    const errorCount = localPreview.errors.length;
    return (
      <ThemeCtx.Provider value={lightTokens}>
        <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
          <Card title="Import existing local SAT Tracker data?" className="w-full max-w-md">
            <p className="text-sm text-slate-600">
              This browser has {testCount} practice test{testCount === 1 ? '' : 's'} and {errorCount} logged error{errorCount === 1 ? '' : 's'} saved
              from before you signed in. Import them into your account, or skip and start fresh in the cloud. Either
              way, nothing already saved in this browser will be deleted.
            </p>
            {migrateError && <p className="mt-3 text-sm text-rose-600">{migrateError}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={handleSkip} disabled={status === 'migrating'}>Skip</Button>
              <Button onClick={handleImport} disabled={status === 'migrating'}>
                {status === 'migrating' ? 'Importing...' : 'Import'}
              </Button>
            </div>
          </Card>
        </div>
      </ThemeCtx.Provider>
    );
  }

  return children;
}
