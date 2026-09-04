import { supabase } from './supabaseClient';

/**
 * Data-access layer for Supabase. Every function here is scoped to a single
 * user (passed explicitly as userId, and enforced server-side by Row Level
 * Security). Row shapes from Postgres (snake_case) are mapped to/from the
 * camelCase shapes SATTracker.jsx's components already expect, so none of
 * the page components had to change.
 */

const DEFAULT_GOALS = { targetTotal: 1400, targetMath: 700, targetRW: 700 };

// ---------------------------------------------------------------- mapping --

function rowToTest(row) {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    mathScore: row.math_score,
    rwScore: row.rw_score,
    totalScore: row.total_score,
    notes: row.notes || '',
  };
}
function testToRow(userId, data) {
  const mathScore = Number(data.mathScore);
  const rwScore = Number(data.rwScore);
  return {
    user_id: userId,
    name: data.name,
    date: data.date,
    math_score: mathScore,
    rw_score: rwScore,
    total_score: mathScore + rwScore,
    notes: data.notes || '',
  };
}

function rowToError(row) {
  return {
    id: row.id,
    testId: row.test_id,
    date: row.date,
    section: row.section,
    domain: row.domain,
    topic: row.topic,
    description: row.description || '',
    reason: row.reason,
    explanation: row.explanation || '',
    difficulty: row.difficulty,
    status: row.status,
  };
}
function errorToRow(userId, data) {
  return {
    user_id: userId,
    test_id: data.testId || null,
    date: data.date,
    section: data.section,
    domain: data.domain,
    topic: data.topic,
    description: data.description || '',
    reason: data.reason,
    explanation: data.explanation || '',
    difficulty: data.difficulty,
    status: data.status,
  };
}

// ---------------------------------------------------------- practice_tests --

export async function fetchTests(userId) {
  const { data, error } = await supabase
    .from('practice_tests')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: true });
  if (error) throw error;
  return data.map(rowToTest);
}

export async function insertTest(userId, data) {
  const { data: row, error } = await supabase
    .from('practice_tests')
    .insert(testToRow(userId, data))
    .select()
    .single();
  if (error) throw error;
  return rowToTest(row);
}

export async function updateTestRow(id, data) {
  const mathScore = Number(data.mathScore);
  const rwScore = Number(data.rwScore);
  const { data: row, error } = await supabase
    .from('practice_tests')
    .update({
      name: data.name,
      date: data.date,
      math_score: mathScore,
      rw_score: rwScore,
      total_score: mathScore + rwScore,
      notes: data.notes || '',
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return rowToTest(row);
}

export async function deleteTestRow(id) {
  const { error } = await supabase.from('practice_tests').delete().eq('id', id);
  if (error) throw error;
}

export async function bulkInsertTests(userId, tests) {
  if (!tests || tests.length === 0) return [];
  const { data, error } = await supabase
    .from('practice_tests')
    .insert(tests.map((t) => testToRow(userId, t)))
    .select();
  if (error) throw error;
  return data.map(rowToTest);
}

// ------------------------------------------------------------------ errors --

export async function fetchErrors(userId) {
  const { data, error } = await supabase
    .from('errors')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });
  if (error) throw error;
  return data.map(rowToError);
}

export async function insertErrorRow(userId, data) {
  const { data: row, error } = await supabase
    .from('errors')
    .insert(errorToRow(userId, data))
    .select()
    .single();
  if (error) throw error;
  return rowToError(row);
}

export async function updateErrorRow(id, data) {
  const { data: row, error } = await supabase
    .from('errors')
    .update({
      test_id: data.testId || null,
      date: data.date,
      section: data.section,
      domain: data.domain,
      topic: data.topic,
      description: data.description || '',
      reason: data.reason,
      explanation: data.explanation || '',
      difficulty: data.difficulty,
      status: data.status,
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return rowToError(row);
}

export async function deleteErrorRow(id) {
  const { error } = await supabase.from('errors').delete().eq('id', id);
  if (error) throw error;
}

export async function bulkInsertErrors(userId, errorsArr) {
  if (!errorsArr || errorsArr.length === 0) return [];
  const { data, error } = await supabase
    .from('errors')
    .insert(errorsArr.map((e) => errorToRow(userId, e)))
    .select();
  if (error) throw error;
  return data.map(rowToError);
}

export async function bulkUpdateErrorStatus(userId, { topic, domain, section, fromStatus, toStatus }) {
  const { data, error } = await supabase
    .from('errors')
    .update({ status: toStatus })
    .eq('user_id', userId)
    .eq('topic', topic)
    .eq('domain', domain)
    .eq('section', section)
    .eq('status', fromStatus)
    .select();
  if (error) throw error;
  return data.map(rowToError);
}

// ----------------------------------------------------- profile/settings/goals --

export async function fetchProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return { userName: data?.display_name || '' };
}
export async function updateProfile(userId, userName) {
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: userId, display_name: userName || '', updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function fetchSettings(userId) {
  const { data, error } = await supabase.from('settings').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return { theme: data?.theme === 'dark' ? 'dark' : 'light' };
}
export async function updateSettings(userId, theme) {
  const { error } = await supabase
    .from('settings')
    .upsert({ user_id: userId, theme: theme === 'dark' ? 'dark' : 'light', updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function fetchGoals(userId) {
  const { data, error } = await supabase.from('goals').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return {
    targetTotal: data?.target_total ?? DEFAULT_GOALS.targetTotal,
    targetMath: data?.target_math ?? DEFAULT_GOALS.targetMath,
    targetRW: data?.target_rw ?? DEFAULT_GOALS.targetRW,
  };
}
export async function updateGoals(userId, vals) {
  const { error } = await supabase.from('goals').upsert({
    user_id: userId,
    target_total: vals.targetTotal,
    target_math: vals.targetMath,
    target_rw: vals.targetRW,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

// Combines profile + settings + goals into the single `config` shape the
// rest of the app already works with (userName, theme, targetTotal, etc).
export async function fetchConfig(userId) {
  const [profile, settings, goals] = await Promise.all([
    fetchProfile(userId),
    fetchSettings(userId),
    fetchGoals(userId),
  ]);
  return { ...profile, ...settings, ...goals };
}

// -------------------------------------------------------------- bulk / reset --

export async function deleteAllTestsAndErrors(userId) {
  const { error: errDelErrors } = await supabase.from('errors').delete().eq('user_id', userId);
  if (errDelErrors) throw errDelErrors;
  const { error: errDelTests } = await supabase.from('practice_tests').delete().eq('user_id', userId);
  if (errDelTests) throw errDelTests;
}

export async function deleteAllUserData(userId) {
  await deleteAllTestsAndErrors(userId);
  const { error: e1 } = await supabase
    .from('goals')
    .update({ target_total: DEFAULT_GOALS.targetTotal, target_math: DEFAULT_GOALS.targetMath, target_rw: DEFAULT_GOALS.targetRW })
    .eq('user_id', userId);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from('settings').update({ theme: 'light' }).eq('user_id', userId);
  if (e2) throw e2;
  const { error: e3 } = await supabase.from('profiles').update({ display_name: '' }).eq('id', userId);
  if (e3) throw e3;
}

/**
 * Inserts a batch of tests and their related errors together, remapping each
 * error's testId from the caller's local/temporary id to the real id Supabase
 * assigns on insert. Used by demo data, JSON import, and the localStorage
 * migration prompt, so that tricky id-remapping logic exists in exactly one
 * place instead of being duplicated at every call site.
 */
export async function bulkImportTestsAndErrors(userId, tests, errorsArr, { replace = false } = {}) {
  if (replace) {
    await deleteAllTestsAndErrors(userId);
  }
  const insertedTests = await bulkInsertTests(userId, tests);
  const idMap = new Map();
  tests.forEach((t, i) => {
    if (insertedTests[i]) idMap.set(t.id, insertedTests[i].id);
  });
  const remappedErrors = errorsArr.map((e) => ({ ...e, testId: e.testId ? (idMap.get(e.testId) || null) : null }));
  const insertedErrors = await bulkInsertErrors(userId, remappedErrors);
  return { tests: insertedTests, errors: insertedErrors };
}
