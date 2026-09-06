import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShieldAlert, Loader2, RefreshCw, Ban, CheckCircle2, Trash2, Users, HelpCircle, Gauge,
} from 'lucide-react';
import {
  Card, Button, Field, useTheme, inputCls, todayIso, SECTION_MATH, SECTION_RW, DOMAINS, DIFFICULTIES, SERIF,
} from '../SATTracker.jsx';
import { fetchAdminUsers, toggleUserBlock, fetchAdminQuestions, deleteAdminQuestion } from '../lib/adminApi';

/* ------------------------------------------------------------------ */
/*  Small shared bits                                                   */
/* ------------------------------------------------------------------ */

function ErrorBanner({ message, onRetry }) {
  const t = useTheme();
  if (!message) return null;
  return (
    <div className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${t.dark ? 'border-rose-900/50 bg-rose-950/30' : 'border-rose-200 bg-rose-50'}`}>
      <p className="text-sm text-rose-600">{message}</p>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

function LoadingRow({ label }) {
  const t = useTheme();
  return (
    <div className={`flex items-center gap-2 py-8 text-sm ${t.textMuted}`}>
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

const SUB_TABS = [
  { id: 'users', label: 'Users', icon: Users },
  { id: 'questions', label: 'Questions', icon: HelpCircle },
  { id: 'quota', label: 'Quota', icon: Gauge },
];

/* ------------------------------------------------------------------ */
/*  Users tab                                                           */
/* ------------------------------------------------------------------ */

function UsersTab() {
  const t = useTheme();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    fetchAdminUsers(todayIso())
      .then((res) => setUsers(res.users || []))
      .catch((err) => setError(err.message || 'Could not load users.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleToggle(user) {
    setPendingId(user.id);
    try {
      const res = await toggleUserBlock(user.id);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, isBlocked: res.isBlocked } : u)));
    } catch (err) {
      setError(err.message || 'Could not update this user.');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Card
      title={`Users (${users.length})`}
      subtitle="Everyone with an account. Blocking a user keeps their login working but rejects every read/write on their side."
    >
      <ErrorBanner message={error} onRetry={load} />
      {loading ? (
        <LoadingRow label="Loading users…" />
      ) : (
        <div className="-mx-5 overflow-x-auto sm:-mx-6">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className={`border-b ${t.border} ${t.textFaint}`}>
                <th className="px-5 py-2 font-medium sm:px-6">Name</th>
                <th className="px-5 py-2 font-medium sm:px-6">Joined</th>
                <th className="px-5 py-2 font-medium sm:px-6">Tests</th>
                <th className="px-5 py-2 font-medium sm:px-6">Errors</th>
                <th className="px-5 py-2 font-medium sm:px-6">Streak</th>
                <th className="px-5 py-2 font-medium sm:px-6">Quota today</th>
                <th className="px-5 py-2 font-medium sm:px-6">Status</th>
                <th className="px-5 py-2 font-medium sm:px-6"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={`border-b last:border-0 ${t.border}`}>
                  <td className="px-5 py-3 sm:px-6">
                    <div className="font-medium">{u.displayName || <span className={t.textFaint}>(no name)</span>}</div>
                    <div className={`text-xs ${t.textFaint}`}>{u.id}</div>
                  </td>
                  <td className={`px-5 py-3 sm:px-6 ${t.textMuted}`}>{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="px-5 py-3 tabular-nums sm:px-6">{u.practiceTestCount}</td>
                  <td className="px-5 py-3 tabular-nums sm:px-6">{u.errorCount}</td>
                  <td className="px-5 py-3 tabular-nums sm:px-6">{u.currentStreak}</td>
                  <td className="px-5 py-3 tabular-nums sm:px-6">{u.quotaUsed} / {u.quotaMax}</td>
                  <td className="px-5 py-3 sm:px-6">
                    {u.isBlocked ? (
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${t.dark ? 'bg-rose-500/15 text-rose-400 border-rose-500/30' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>Blocked</span>
                    ) : (
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${t.dark ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>Active</span>
                    )}
                  </td>
                  <td className="px-5 py-3 sm:px-6">
                    <Button
                      size="sm"
                      variant={u.isBlocked ? 'secondary' : 'danger'}
                      disabled={pendingId === u.id}
                      onClick={() => handleToggle(u)}
                    >
                      {pendingId === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : u.isBlocked ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                      {u.isBlocked ? 'Unblock' : 'Block'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Questions tab                                                       */
/* ------------------------------------------------------------------ */

const ALL_DOMAINS = [...DOMAINS[SECTION_MATH], ...DOMAINS[SECTION_RW]];

function QuestionsTab() {
  const t = useTheme();
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [filters, setFilters] = useState({ section: '', domain: '', topic: '', difficulty: '' });

  const load = useCallback((f) => {
    setLoading(true);
    setError('');
    fetchAdminQuestions(f)
      .then((res) => setQuestions(res.questions || []))
      .catch((err) => setError(err.message || 'Could not load the question pool.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(filters); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function applyFilters(e) {
    e.preventDefault();
    load(filters);
  }

  async function handleDelete(q) {
    setDeletingId(q.id);
    try {
      await deleteAdminQuestion(q.id);
      setQuestions((prev) => prev.filter((x) => x.id !== q.id));
    } catch (err) {
      setError(err.message || 'Could not delete this question.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card title="Filter the shared pool">
        <form onSubmit={applyFilters} className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Field label="Section">
            <select className={inputCls(t)} value={filters.section} onChange={(e) => setFilters((f) => ({ ...f, section: e.target.value, domain: '' }))}>
              <option value="">All</option>
              <option value={SECTION_MATH}>{SECTION_MATH}</option>
              <option value={SECTION_RW}>{SECTION_RW}</option>
            </select>
          </Field>
          <Field label="Domain">
            <select className={inputCls(t)} value={filters.domain} onChange={(e) => setFilters((f) => ({ ...f, domain: e.target.value }))}>
              <option value="">All</option>
              {(filters.section ? DOMAINS[filters.section] : ALL_DOMAINS).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Topic">
            <input className={inputCls(t)} placeholder="Any" value={filters.topic} onChange={(e) => setFilters((f) => ({ ...f, topic: e.target.value }))} />
          </Field>
          <Field label="Difficulty">
            <select className={inputCls(t)} value={filters.difficulty} onChange={(e) => setFilters((f) => ({ ...f, difficulty: e.target.value }))}>
              <option value="">All</option>
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-4">
            <Button type="submit" size="sm"><RefreshCw className="h-3.5 w-3.5" />Apply filters</Button>
          </div>
        </form>
      </Card>

      <Card title={`Question pool (${questions.length})`} subtitle="Shared across every student. Deleting a question removes it and everyone's view history for it.">
        <ErrorBanner message={error} onRetry={() => load(filters)} />
        {loading ? (
          <LoadingRow label="Loading questions…" />
        ) : questions.length === 0 ? (
          <p className={`py-8 text-center text-sm ${t.textMuted}`}>No questions match these filters.</p>
        ) : (
          <div className="space-y-3">
            {questions.map((q) => (
              <div key={q.id} className={`rounded-lg border p-4 ${t.border}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className={`flex flex-wrap items-center gap-2 text-xs ${t.textFaint}`}>
                      <span>{q.section}</span><span>·</span><span>{q.domain}</span><span>·</span><span>{q.topic}</span><span>·</span><span>{q.difficulty}</span>
                    </div>
                    <p className="mt-2 text-sm">{q.stem}</p>
                    <div className={`mt-2 text-xs ${t.textFaint}`}>
                      Viewed by {q.viewCount} {q.viewCount === 1 ? 'user' : 'users'} · {q.model || 'unknown model'} · {new Date(q.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <Button size="sm" variant="danger" disabled={deletingId === q.id} onClick={() => handleDelete(q)}>
                    {deletingId === q.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Quota tab                                                           */
/* ------------------------------------------------------------------ */

function QuotaTab() {
  const t = useTheme();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    fetchAdminUsers(todayIso())
      .then((res) => setUsers(res.users || []))
      .catch((err) => setError(err.message || 'Could not load quota usage.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const sorted = useMemo(() => [...users].sort((a, b) => b.quotaUsed - a.quotaUsed), [users]);

  return (
    <Card title="Today's practice-question quota" subtitle="New Gemini generations per user, today only. Serving an already-generated pool question never counts against this.">
      <ErrorBanner message={error} onRetry={load} />
      {loading ? (
        <LoadingRow label="Loading quota usage…" />
      ) : sorted.length === 0 ? (
        <p className={`py-8 text-center text-sm ${t.textMuted}`}>No users yet.</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((u) => {
            const pct = u.quotaMax > 0 ? Math.min(100, Math.round((u.quotaUsed / u.quotaMax) * 100)) : 0;
            return (
              <div key={u.id} className="flex items-center gap-3">
                <div className="w-40 shrink-0 truncate text-sm">{u.displayName || u.id}</div>
                <div className={`h-2 flex-1 overflow-hidden rounded-full ${t.dark ? 'bg-slate-800' : 'bg-slate-100'}`}>
                  <div className={`h-full ${pct >= 100 ? 'bg-rose-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="w-16 shrink-0 text-right text-sm tabular-nums">{u.quotaUsed} / {u.quotaMax}</div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Top-level panel                                                     */
/* ------------------------------------------------------------------ */

export default function AdminPanel() {
  const t = useTheme();
  const [tab, setTab] = useState('users');

  return (
    <div className="space-y-6">
      <div className={`flex items-center gap-2 rounded-xl border p-4 ${t.dark ? 'border-amber-900/50 bg-amber-950/20' : 'border-amber-200 bg-amber-50'}`}>
        <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-sm text-amber-700 dark:text-amber-400">Admin-only panel. Actions here affect other users' accounts.</p>
      </div>

      <div className={`flex gap-1 border-b ${t.border}`}>
        {SUB_TABS.map((item) => {
          const active = tab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm transition-colors ${active ? 'border-amber-500 font-medium' : `border-transparent ${t.textMuted} hover:${t.text}`}`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === 'users' && <UsersTab />}
      {tab === 'questions' && <QuestionsTab />}
      {tab === 'quota' && <QuotaTab />}
    </div>
  );
}
