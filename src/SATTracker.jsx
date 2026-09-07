import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from './auth/AuthContext';
import * as db from './lib/db';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from 'recharts';
import {
  LayoutDashboard, ClipboardList, AlertTriangle, BarChart3, Repeat, Target, Settings,
  Plus, Pencil, Trash2, X, Download, Upload, Search, ChevronDown, Menu, Sparkles,
  CheckCircle2, LogOut, Brain, Lightbulb, RefreshCw, TrendingUp, TrendingDown, Minus, Loader2,
  Flame, ShieldAlert,
} from 'lucide-react';
import { fetchPerformanceAnalysis, analyzeMistake as analyzeMistakeApi, requestPracticeQuestion } from './lib/ai';
import AdminPanel from './admin/AdminPanel.jsx';
import {
  SECTION_MATH, SECTION_RW, DOMAINS, DIFFICULTIES, SERIF, toLocalIso, todayIso,
  lightTokens, darkTokens, ThemeCtx, useTheme, inputCls, Button, Card, Field,
} from './shared/ui.jsx';

/* ------------------------------------------------------------------ */
/*  Constants & data model                                             */
/* ------------------------------------------------------------------ */

const TOPICS = {
  'Algebra': ['Linear equations in one variable', 'Linear functions', 'Linear inequalities', 'Systems of two linear equations', 'Linear equations in two variables'],
  'Advanced Math': ['Nonlinear functions', 'Nonlinear equations in one variable', 'Equivalent expressions', 'Exponential functions'],
  'Problem-Solving and Data Analysis': ['Ratios, rates, and proportions', 'Percentages', 'One-variable data: distributions', 'Two-variable data: models and scatterplots', 'Probability and conditional probability', 'Statistical claims and study design'],
  'Geometry and Trigonometry': ['Area and volume', 'Lines, angles, and triangles', 'Right triangles and trigonometry', 'Circles'],
  'Information and Ideas': ['Central ideas and details', 'Inferences', 'Command of evidence (textual)', 'Command of evidence (quantitative)'],
  'Craft and Structure': ['Words in context', 'Text structure and purpose', 'Cross-text connections'],
  'Expression of Ideas': ['Rhetorical synthesis', 'Transitions'],
  'Standard English Conventions': ['Boundaries (punctuation)', 'Form, structure, and sense'],
};

const REASONS = ['Careless error', 'Misread the question', "Didn't know the concept", 'Ran out of time', 'Wrong strategy or approach', 'Overcomplicated it', 'Second-guessed the correct answer', 'Other'];
const STATUSES = ['Unreviewed', 'Reviewing', 'Mastered'];

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'tests', label: 'Practice Tests', icon: ClipboardList },
  { id: 'errors', label: 'Error Log', icon: AlertTriangle },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'ai-analysis', label: 'AI Analysis', icon: Brain },
  { id: 'review', label: 'Review', icon: Repeat },
  { id: 'goals', label: 'Goals', icon: Target },
  { id: 'settings', label: 'Settings', icon: Settings },
];

// Cosmetic only, never the real security boundary - see AdminPanel.jsx and
// api/admin/*.js, which independently verify the caller server-side.
const ADMIN_NAV_ITEM = { id: 'admin', label: 'Admin', icon: ShieldAlert };

const DEFAULT_CONFIG = { userName: '', theme: 'light', targetTotal: 1400, targetMath: 700, targetRW: 700 };
export const K = { TESTS: 'sat-tracker:practice-tests', ERRORS: 'sat-tracker:error-log', CONFIG: 'sat-tracker:app-config' };

const MONO = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

// Single source of truth for chart colors, referenced by every chart instead of
// repeating raw hex values across components.
const CHART_COLORS = {
  total: '#D97706', // amber-600
  math: '#6366F1', // indigo-500
  rw: '#0EA5E9', // sky-500
  reason: '#D97706', // amber-600
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtShort(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function isoDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return toLocalIso(d); }
function statusTone(status) { return status === 'Mastered' ? 'emerald' : status === 'Reviewing' ? 'amber' : 'rose'; }

/**
 * Defensive validation applied to any data coming from outside a normal form
 * submission (localStorage reads, JSON imports). Guarantees every record has
 * the fields the rest of the app assumes exist, coerces scores into valid
 * ranges, and re-derives totalScore so Math + R&W always add up to Total,
 * even if the source data was hand-edited or from an older/foreign export.
 * Anything that isn't shaped like an array is treated as empty rather than
 * crashing every page that calls .map/.filter/.sort on it.
 */
export function sanitizeTests(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((t) => t && typeof t === 'object' && typeof t.date === 'string' && t.date)
    .map((t) => {
      const mathScore = clamp(Math.round(Number(t.mathScore)) || 500, 200, 800);
      const rwScore = clamp(Math.round(Number(t.rwScore)) || 500, 200, 800);
      return {
        id: typeof t.id === 'string' && t.id ? t.id : genId('test'),
        name: typeof t.name === 'string' && t.name.trim() ? t.name.trim() : 'Practice Test',
        date: t.date,
        mathScore,
        rwScore,
        totalScore: mathScore + rwScore,
        notes: typeof t.notes === 'string' ? t.notes : '',
      };
    });
}

export function sanitizeErrors(arr, validTestIds) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((e) => e && typeof e === 'object' && typeof e.topic === 'string' && e.topic.trim())
    .map((e) => {
      const section = e.section === SECTION_MATH || e.section === SECTION_RW ? e.section : SECTION_MATH;
      const domain = typeof e.domain === 'string' && DOMAINS[section].includes(e.domain) ? e.domain : DOMAINS[section][0];
      return {
        id: typeof e.id === 'string' && e.id ? e.id : genId('err'),
        testId: e.testId && validTestIds.has(e.testId) ? e.testId : null,
        date: typeof e.date === 'string' && e.date ? e.date : todayIso(),
        section,
        domain,
        topic: e.topic.trim(),
        description: typeof e.description === 'string' ? e.description : '',
        reason: typeof e.reason === 'string' && e.reason.trim() ? e.reason : 'Other',
        explanation: typeof e.explanation === 'string' ? e.explanation : '',
        difficulty: DIFFICULTIES.includes(e.difficulty) ? e.difficulty : 'Medium',
        status: STATUSES.includes(e.status) ? e.status : 'Unreviewed',
      };
    });
}

export function sanitizeConfig(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { ...DEFAULT_CONFIG };
  return {
    userName: typeof cfg.userName === 'string' ? cfg.userName : DEFAULT_CONFIG.userName,
    theme: cfg.theme === 'dark' ? 'dark' : 'light',
    targetTotal: clamp(Math.round(Number(cfg.targetTotal)) || DEFAULT_CONFIG.targetTotal, 400, 1600),
    targetMath: clamp(Math.round(Number(cfg.targetMath)) || DEFAULT_CONFIG.targetMath, 200, 800),
    targetRW: clamp(Math.round(Number(cfg.targetRW)) || DEFAULT_CONFIG.targetRW, 200, 800),
  };
}

function topicStats(errors) {
  const map = new Map();
  errors.forEach((e) => {
    const key = `${e.topic}||${e.domain}||${e.section}`;
    if (!map.has(key)) map.set(key, { topic: e.topic, domain: e.domain, section: e.section, total: 0, unreviewed: 0, reviewing: 0, mastered: 0 });
    const s = map.get(key);
    s.total += 1;
    if (e.status === 'Unreviewed') s.unreviewed += 1;
    else if (e.status === 'Reviewing') s.reviewing += 1;
    else if (e.status === 'Mastered') s.mastered += 1;
  });
  return Array.from(map.values()).map((s) => ({ ...s, score: s.total * 1 + s.unreviewed * 2 + s.reviewing * 1 - s.mastered * 1.5 }));
}
function byKey(errors, key) {
  const map = new Map();
  errors.forEach((e) => map.set(e[key], (map.get(e[key]) || 0) + 1));
  return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}
function byDomainWithSection(errors) {
  const map = new Map();
  errors.forEach((e) => {
    if (!map.has(e.domain)) map.set(e.domain, { name: e.domain, value: 0, section: e.section });
    map.get(e.domain).value += 1;
  });
  return Array.from(map.values()).sort((a, b) => b.value - a.value);
}
function byTopicWithSection(errors) {
  const map = new Map();
  errors.forEach((e) => {
    if (!map.has(e.topic)) map.set(e.topic, { name: e.topic, value: 0, section: e.section });
    map.get(e.topic).value += 1;
  });
  return Array.from(map.values()).sort((a, b) => b.value - a.value).slice(0, 8);
}

function buildDemoData() {
  const testDefs = [
    { daysAgo: 126, name: 'Diagnostic Test', math: 510, rw: 530, notes: 'Baseline diagnostic, cold with no prep.' },
    { daysAgo: 108, name: 'Practice Test 2', math: 540, rw: 550, notes: 'Timing was tight in the second Math module.' },
    { daysAgo: 90, name: 'Practice Test 3', math: 560, rw: 570, notes: 'Pacing improved. Still missing inference questions.' },
    { daysAgo: 72, name: 'Practice Test 4', math: 590, rw: 580, notes: 'Reviewing algebra fundamentals is paying off.' },
    { daysAgo: 54, name: 'Practice Test 5', math: 610, rw: 600, notes: 'Careless errors cost roughly 30 points this round.' },
    { daysAgo: 30, name: 'Practice Test 6', math: 640, rw: 620, notes: 'Strong first module in both sections, slipped a bit in module two.' },
    { daysAgo: 8, name: 'Practice Test 7', math: 670, rw: 650, notes: 'Best score yet. Grammar rules are finally clicking.' },
  ];
  const tests = testDefs.map((d) => ({
    id: genId('test'), name: d.name, date: isoDaysAgo(d.daysAgo),
    mathScore: d.math, rwScore: d.rw, totalScore: d.math + d.rw, notes: d.notes,
  }));

  const errorDefs = [
    { t: 0, section: SECTION_MATH, domain: 'Algebra', topic: 'Linear equations in one variable', description: 'Forgot to distribute the negative sign across the parentheses before combining terms.', reason: 'Careless error', explanation: 'Distribute -1 through (x - 3) to get -x + 3 before combining like terms.', difficulty: 'Easy', status: 'Mastered' },
    { t: 1, section: SECTION_MATH, domain: 'Algebra', topic: 'Systems of two linear equations', description: 'Set up one equation correctly but transcribed the second equation\'s constant wrong.', reason: 'Misread the question', explanation: 'Reread the problem and underline given values before setting up each equation.', difficulty: 'Medium', status: 'Mastered' },
    { t: 3, section: SECTION_MATH, domain: 'Algebra', topic: 'Linear inequalities', description: 'Forgot to flip the inequality sign when dividing both sides by a negative number.', reason: "Didn't know the concept", explanation: 'Dividing or multiplying an inequality by a negative number flips the inequality sign.', difficulty: 'Easy', status: 'Reviewing' },
    { t: 4, section: SECTION_MATH, domain: 'Advanced Math', topic: 'Nonlinear equations in one variable', description: 'Factored the quadratic incorrectly and missed a sign.', reason: 'Careless error', explanation: 'Check a factored form by expanding it back out before finalizing an answer.', difficulty: 'Medium', status: 'Reviewing' },
    { t: 5, section: SECTION_MATH, domain: 'Advanced Math', topic: 'Exponential functions', description: 'Confused the growth and decay formulas.', reason: "Didn't know the concept", explanation: 'Growth: a(1+r)^t. Decay: a(1-r)^t. r is the percent change written as a decimal.', difficulty: 'Hard', status: 'Unreviewed' },
    { t: 6, section: SECTION_MATH, domain: 'Advanced Math', topic: 'Equivalent expressions', description: "Didn't fully factor before comparing the two expressions.", reason: 'Wrong strategy or approach', explanation: 'Factor completely first, then compare the expressions term by term.', difficulty: 'Hard', status: 'Unreviewed' },
    { t: 1, section: SECTION_MATH, domain: 'Problem-Solving and Data Analysis', topic: 'Ratios, rates, and proportions', description: 'Set up the proportion upside down.', reason: 'Careless error', explanation: 'Keep the same units aligned on the same side across both ratios.', difficulty: 'Easy', status: 'Mastered' },
    { t: 2, section: SECTION_MATH, domain: 'Problem-Solving and Data Analysis', topic: 'Percentages', description: 'Calculated percent change using the wrong base value.', reason: "Didn't know the concept", explanation: 'Percent change equals (new - old) divided by old, never by new.', difficulty: 'Medium', status: 'Mastered' },
    { t: 5, section: SECTION_MATH, domain: 'Problem-Solving and Data Analysis', topic: 'Two-variable data: models and scatterplots', description: 'Misread the direction of the trend line on the scatterplot.', reason: 'Misread the question', explanation: 'Check whether the line is increasing or decreasing before estimating its slope.', difficulty: 'Medium', status: 'Reviewing' },
    { t: 6, section: SECTION_MATH, domain: 'Problem-Solving and Data Analysis', topic: 'Probability and conditional probability', description: 'Forgot to shrink the sample space to the given condition.', reason: "Didn't know the concept", explanation: 'Conditional probability narrows the sample space to the given event first.', difficulty: 'Hard', status: 'Unreviewed' },
    { t: 6, section: SECTION_MATH, domain: 'Problem-Solving and Data Analysis', topic: 'Statistical claims and study design', description: 'Assumed a correlation in the data implied causation.', reason: "Didn't know the concept", explanation: 'Only a randomized experiment supports a causal claim, not an observational study.', difficulty: 'Medium', status: 'Unreviewed' },
    { t: 2, section: SECTION_MATH, domain: 'Geometry and Trigonometry', topic: 'Right triangles and trigonometry', description: 'Mixed up the sine and cosine ratios.', reason: 'Careless error', explanation: 'SOH-CAH-TOA: sine is opposite over hypotenuse, cosine is adjacent over hypotenuse.', difficulty: 'Easy', status: 'Mastered' },
    { t: 4, section: SECTION_MATH, domain: 'Geometry and Trigonometry', topic: 'Area and volume', description: 'Used the diameter instead of the radius in the area formula.', reason: 'Careless error', explanation: 'Circle area uses the radius: A = pi r^2. Halve the diameter first.', difficulty: 'Easy', status: 'Reviewing' },
    { t: 6, section: SECTION_MATH, domain: 'Geometry and Trigonometry', topic: 'Circles', description: 'Forgot the relationship between arc length and central angle.', reason: "Didn't know the concept", explanation: 'Arc length equals (angle / 360) times the circumference.', difficulty: 'Hard', status: 'Unreviewed' },
    { t: 0, section: SECTION_RW, domain: 'Information and Ideas', topic: 'Central ideas and details', description: 'Picked an answer that was true but not actually the main point.', reason: 'Misread the question', explanation: "The right answer has to answer exactly what's asked, not just be a true statement from the passage.", difficulty: 'Medium', status: 'Mastered' },
    { t: 3, section: SECTION_RW, domain: 'Information and Ideas', topic: 'Inferences', description: 'Chose an answer that went further than what the text actually supports.', reason: 'Overcomplicated it', explanation: 'Inference answers must be directly supported by the text, not just plausible.', difficulty: 'Hard', status: 'Reviewing' },
    { t: 5, section: SECTION_RW, domain: 'Information and Ideas', topic: 'Command of evidence (textual)', description: 'Selected a quote that was on-topic but did not actually support the claim.', reason: 'Misread the question', explanation: 'Match the quote to the specific claim in the question, not just the general topic.', difficulty: 'Medium', status: 'Unreviewed' },
    { t: 6, section: SECTION_RW, domain: 'Information and Ideas', topic: 'Command of evidence (quantitative)', description: 'Misread the axis labels on the data table.', reason: 'Careless error', explanation: 'Check units and axis labels carefully before interpreting any data.', difficulty: 'Medium', status: 'Unreviewed' },
    { t: 1, section: SECTION_RW, domain: 'Craft and Structure', topic: 'Words in context', description: "Chose a synonym that didn't fit the sentence's tone.", reason: 'Second-guessed the correct answer', explanation: 'Plug each option back into the sentence and check tone, not just definition.', difficulty: 'Medium', status: 'Mastered' },
    { t: 4, section: SECTION_RW, domain: 'Craft and Structure', topic: 'Words in context', description: 'Picked the most common meaning of the word instead of its contextual meaning.', reason: "Didn't know the concept", explanation: 'These questions often test a secondary or contextual meaning, not the everyday one.', difficulty: 'Medium', status: 'Reviewing' },
    { t: 6, section: SECTION_RW, domain: 'Craft and Structure', topic: 'Text structure and purpose', description: 'Confused the function of a paragraph with what it was simply about.', reason: 'Overcomplicated it', explanation: 'Ask what job the paragraph does in the passage, not just what topic it covers.', difficulty: 'Hard', status: 'Unreviewed' },
    { t: 5, section: SECTION_RW, domain: 'Craft and Structure', topic: 'Cross-text connections', description: 'Focused on similarities and missed the key disagreement between the two texts.', reason: 'Misread the question', explanation: "Identify each author's stance first, then compare the two directly.", difficulty: 'Hard', status: 'Unreviewed' },
    { t: 2, section: SECTION_RW, domain: 'Expression of Ideas', topic: 'Rhetorical synthesis', description: "Included an accurate detail that didn't match the stated goal.", reason: 'Misread the question', explanation: 'Reread the stated goal and pick only the option that fulfills it exactly.', difficulty: 'Medium', status: 'Mastered' },
    { t: 4, section: SECTION_RW, domain: 'Expression of Ideas', topic: 'Transitions', description: "Used 'however' where the two sentences actually agree.", reason: "Didn't know the concept", explanation: 'Check whether the relationship between sentences is contrast, cause, or continuation.', difficulty: 'Easy', status: 'Reviewing' },
    { t: 6, section: SECTION_RW, domain: 'Standard English Conventions', topic: 'Boundaries (punctuation)', description: 'Added a comma before a restrictive clause.', reason: "Didn't know the concept", explanation: 'Restrictive clauses take no commas. They are essential to the sentence\'s meaning.', difficulty: 'Medium', status: 'Unreviewed' },
    { t: 5, section: SECTION_RW, domain: 'Standard English Conventions', topic: 'Form, structure, and sense', description: 'Made the verb agree with the nearest noun instead of the true subject.', reason: 'Careless error', explanation: 'Find the true subject of the verb and ignore any phrases sitting between them.', difficulty: 'Medium', status: 'Unreviewed' },
    { t: 1, section: SECTION_RW, domain: 'Standard English Conventions', topic: 'Boundaries (punctuation)', description: 'Used a comma splice to join two independent clauses.', reason: "Didn't know the concept", explanation: 'Join independent clauses with a period, a semicolon, or a comma plus conjunction.', difficulty: 'Easy', status: 'Mastered' },
  ];
  const errors = errorDefs.map((d) => ({
    id: genId('err'), testId: tests[d.t].id, date: tests[d.t].date, section: d.section, domain: d.domain,
    topic: d.topic, description: d.description, reason: d.reason, explanation: d.explanation,
    difficulty: d.difficulty, status: d.status,
  }));
  return { tests, errors };
}

/* ------------------------------------------------------------------ */
/*  Theme (ThemeCtx/useTheme/lightTokens/darkTokens/inputCls now live   */
/*  in shared/ui.jsx, imported above)                                   */
/* ------------------------------------------------------------------ */

// Shared dialog behavior for Modal/ConfirmDialog: closes on Escape and locks
// background scroll while open. Centralized so both components stay consistent.
function useDialogBehavior(active, onClose) {
  useEffect(() => {
    if (!active) return undefined;
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [active, onClose]);
}

/* ------------------------------------------------------------------ */
/*  Small shared UI                                                     */
/* ------------------------------------------------------------------ */

function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,500;8..60,600;8..60,700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
      @keyframes sbFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      .sb-fade-in { animation: sbFadeIn 0.35s ease-out; }
      @keyframes sbStreakBump { 0% { transform: scale(1); } 35% { transform: scale(1.22); } 65% { transform: scale(0.94); } 100% { transform: scale(1); } }
      .sb-streak-bump { animation: sbStreakBump 0.6s ease-out; }
      input:focus-visible, button:focus-visible, select:focus-visible, textarea:focus-visible, a:focus-visible { outline: 2px solid #D97706; outline-offset: 2px; }
      @media (prefers-reduced-motion: reduce) { .sb-fade-in, .sb-streak-bump { animation: none; } }
    `}</style>
  );
}

// Button/Card/Field now live in shared/ui.jsx, imported above.

function IconButton({ icon: Icon, onClick, label, tone = 'default' }) {
  const t = useTheme();
  const toneCls = tone === 'danger'
    ? (t.dark ? 'hover:text-rose-400 hover:bg-rose-500/10' : 'hover:text-rose-600 hover:bg-rose-50')
    : t.hoverSubtle;
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={`rounded-lg p-2 ${t.textMuted} ${toneCls}`}>
      <Icon className="h-4 w-4" />
    </button>
  );
}

function Badge({ children, tone = 'neutral' }) {
  const t = useTheme();
  const tones = {
    neutral: t.chip,
    amber: t.dark ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' : 'bg-amber-50 text-amber-700 border-amber-200',
    rose: t.dark ? 'bg-rose-500/15 text-rose-400 border-rose-500/30' : 'bg-rose-50 text-rose-700 border-rose-200',
    emerald: t.dark ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border-emerald-200',
    indigo: t.dark ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' : 'bg-indigo-50 text-indigo-700 border-indigo-200',
    sky: t.dark ? 'bg-sky-500/15 text-sky-400 border-sky-500/30' : 'bg-sky-50 text-sky-700 border-sky-200',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone] || tones.neutral}`}>{children}</span>;
}

function EmptyState({ icon: Icon, title, description, action }) {
  const t = useTheme();
  return (
    <div className={`flex flex-col items-center justify-center rounded-2xl border border-dashed p-12 text-center ${t.border}`}>
      {Icon && <Icon className={`mb-4 h-8 w-8 ${t.textFaint}`} />}
      <h3 className={`text-lg font-semibold ${t.text}`} style={SERIF}>{title}</h3>
      <p className={`mt-2 max-w-sm text-sm ${t.textMuted}`}>{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

function StatCard({ label, value, sub, subTone }) {
  const t = useTheme();
  return (
    <div className={`rounded-xl border p-5 ${t.card}`}>
      <div className={`text-sm font-medium ${t.textMuted}`}>{label}</div>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${t.text}`} style={MONO}>{value}</div>
      {sub && <div className={`mt-2 text-sm ${subTone || t.textMuted}`}>{sub}</div>}
    </div>
  );
}

function ProgressBar({ value, max, colorClass }) {
  const t = useTheme();
  const pct = max > 0 ? clamp((value / max) * 100, 0, 100) : 0;
  return (
    <div className={`h-2.5 w-full overflow-hidden rounded-full ${t.dark ? 'bg-slate-800' : 'bg-slate-100'}`}>
      <div className={`h-full rounded-full transition-all duration-500 ${colorClass}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Modal({ open, onClose, title, children, wide }) {
  const t = useTheme();
  useDialogBehavior(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center" onClick={onClose}>
      <div className="fixed inset-0 bg-slate-950/60" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sb-modal-title"
        className={`relative my-8 w-full rounded-2xl border shadow-xl ${wide ? 'max-w-2xl' : 'max-w-lg'} ${t.card}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between border-b px-6 py-4 ${t.border}`}>
          <h3 id="sb-modal-title" className="text-lg font-semibold" style={SERIF}>{title}</h3>
          <button type="button" onClick={onClose} className={`rounded-full p-1.5 ${t.textMuted} ${t.hoverSubtle}`}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function ConfirmDialog({ state, onCancel }) {
  const t = useTheme();
  useDialogBehavior(!!state, onCancel);
  if (!state) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="fixed inset-0 bg-slate-950/60" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sb-confirm-title"
        className={`relative w-full max-w-sm rounded-2xl border p-6 shadow-xl ${t.card}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="sb-confirm-title" className="text-lg font-semibold" style={SERIF}>{state.title}</h3>
        <p className={`mt-2 text-sm ${t.textMuted}`}>{state.message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button variant={state.danger ? 'danger' : 'primary'} onClick={() => { state.onConfirm(); onCancel(); }}>
            {state.confirmLabel || 'Confirm'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ToastStack({ toasts }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2">
      {toasts.map((tst) => (
        <div
          key={tst.id}
          className={`pointer-events-auto rounded-lg px-4 py-2.5 text-sm shadow-lg ${tst.type === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'}`}
        >
          {tst.message}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Charts                                                              */
/* ------------------------------------------------------------------ */

function ScoreLineChart({ data, height = 280 }) {
  const t = useTheme();
  if (!data || data.length === 0) return <p className={`text-sm ${t.textMuted}`}>Add a practice test to see this chart.</p>;
  const grid = t.dark ? '#1E293B' : '#E2E8F0';
  const tick = t.dark ? '#94A3B8' : '#64748B';
  const tooltipStyle = { background: t.dark ? '#0F172A' : '#FFFFFF', border: `1px solid ${grid}`, borderRadius: 8, fontSize: 12 };
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: tick }} />
          <YAxis domain={[400, 1600]} ticks={[400, 700, 1000, 1300, 1600]} tick={{ fontSize: 12, fill: tick }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="Total" stroke={CHART_COLORS.total} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          <Line type="monotone" dataKey="Math" stroke={CHART_COLORS.math} strokeWidth={2} dot={{ r: 2.5 }} />
          <Line type="monotone" dataKey="R&W" stroke={CHART_COLORS.rw} strokeWidth={2} dot={{ r: 2.5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function MiniLineChart({ data, dataKey, color, height = 220 }) {
  const t = useTheme();
  if (!data || data.length === 0) return <p className={`text-sm ${t.textMuted}`}>Add a practice test to see this chart.</p>;
  const grid = t.dark ? '#1E293B' : '#E2E8F0';
  const tick = t.dark ? '#94A3B8' : '#64748B';
  const tooltipStyle = { background: t.dark ? '#0F172A' : '#FFFFFF', border: `1px solid ${grid}`, borderRadius: 8, fontSize: 12 };
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: tick }} />
          <YAxis domain={[200, 800]} ticks={[200, 400, 600, 800]} tick={{ fontSize: 11, fill: tick }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.5} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RankedBarChart({ data, color = CHART_COLORS.total, colors, height = 220 }) {
  const t = useTheme();
  if (!data || data.length === 0) return <p className={`text-sm ${t.textMuted}`}>No data yet.</p>;
  const grid = t.dark ? '#1E293B' : '#E2E8F0';
  const tick = t.dark ? '#94A3B8' : '#64748B';
  const catTick = t.dark ? '#CBD5E1' : '#334155';
  const tooltipStyle = { background: t.dark ? '#0F172A' : '#FFFFFF', border: `1px solid ${grid}`, borderRadius: 8, fontSize: 12 };
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 20, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: tick }} />
          <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 11, fill: catTick }} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: t.dark ? 'rgba(148,163,184,0.08)' : 'rgba(100,116,139,0.06)' }} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={18}>
            {data.map((d, i) => <Cell key={i} fill={colors ? colors[i % colors.length] : color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MasterySegmentedBar({ unreviewed, reviewing, mastered }) {
  const t = useTheme();
  const total = unreviewed + reviewing + mastered || 1;
  const segs = [
    { label: 'Mastered', value: mastered, cls: 'bg-emerald-500' },
    { label: 'Reviewing', value: reviewing, cls: 'bg-amber-500' },
    { label: 'Unreviewed', value: unreviewed, cls: 'bg-rose-500' },
  ];
  return (
    <div>
      <div className={`flex h-4 w-full overflow-hidden rounded-full ${t.dark ? 'bg-slate-800' : 'bg-slate-100'}`}>
        {segs.map((s) => s.value > 0 && (
          <div key={s.label} className={s.cls} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label}: ${s.value}`} />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        {segs.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${s.cls}`} />
            {s.label} <span className="tabular-nums font-medium">{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Forms                                                               */
/* ------------------------------------------------------------------ */

function TestForm({ initial, onCancel, onSubmit }) {
  const t = useTheme();
  const [name, setName] = useState(initial ? initial.name : '');
  const [date, setDate] = useState(initial ? initial.date : todayIso());
  const [mathScore, setMathScore] = useState(initial ? initial.mathScore : 500);
  const [rwScore, setRwScore] = useState(initial ? initial.rwScore : 500);
  const [notes, setNotes] = useState(initial ? initial.notes : '');
  const [err, setErr] = useState('');
  const total = (Number(mathScore) || 0) + (Number(rwScore) || 0);

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) return setErr('Give this test a name.');
    if (!date) return setErr('Pick a date.');
    const m = Number(mathScore), r = Number(rwScore);
    if (Number.isNaN(m) || Number.isNaN(r) || m < 200 || m > 800 || r < 200 || r > 800) {
      return setErr('Section scores must be between 200 and 800.');
    }
    setErr('');
    onSubmit({ name: name.trim(), date, mathScore: m, rwScore: r, notes: notes.trim() });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Test name">
        <input className={inputCls(t)} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Practice Test 4" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Date">
          <input type="date" className={inputCls(t)} value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Total score" hint="Math + R&W, calculated for you">
          <input disabled value={total} className={`${inputCls(t)} opacity-70`} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Math score">
          <input type="number" min={200} max={800} step={10} className={inputCls(t)} value={mathScore} onChange={(e) => setMathScore(e.target.value)} />
        </Field>
        <Field label="Reading & Writing score">
          <input type="number" min={200} max={800} step={10} className={inputCls(t)} value={rwScore} onChange={(e) => setRwScore(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <textarea rows={3} className={inputCls(t)} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What went well, what didn't, pacing notes..." />
      </Field>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit">{initial ? 'Save changes' : 'Add test'}</Button>
      </div>
    </form>
  );
}

function ErrorForm({ initial, tests, onCancel, onSubmit }) {
  const t = useTheme();
  const [testId, setTestId] = useState(initial ? (initial.testId || '') : '');
  const [date, setDate] = useState(initial ? initial.date : todayIso());
  const [section, setSection] = useState(initial ? initial.section : SECTION_MATH);
  const [domain, setDomain] = useState(initial ? initial.domain : DOMAINS[SECTION_MATH][0]);
  const [topic, setTopic] = useState(initial ? initial.topic : '');
  const [description, setDescription] = useState(initial ? initial.description : '');
  const isPresetReason = initial ? REASONS.includes(initial.reason) : true;
  const [reason, setReason] = useState(initial ? (isPresetReason ? initial.reason : 'Other') : REASONS[0]);
  const [reasonOther, setReasonOther] = useState(initial && !isPresetReason ? initial.reason : '');
  const [explanation, setExplanation] = useState(initial ? initial.explanation : '');
  const [difficulty, setDifficulty] = useState(initial ? initial.difficulty : 'Medium');
  const [status, setStatus] = useState(initial ? initial.status : 'Unreviewed');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!DOMAINS[section].includes(domain)) setDomain(DOMAINS[section][0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  function handleTestSelect(id) {
    setTestId(id);
    const found = tests.find((x) => x.id === id);
    if (found) setDate(found.date);
  }

  function submit(e) {
    e.preventDefault();
    if (!topic.trim()) return setErr('Add a topic.');
    if (!description.trim()) return setErr('Describe the mistake.');
    const finalReason = reason === 'Other' ? (reasonOther.trim() || 'Other') : reason;
    setErr('');
    onSubmit({
      testId: testId || null, date, section, domain, topic: topic.trim(),
      description: description.trim(), reason: finalReason, explanation: explanation.trim(),
      difficulty, status,
    });
  }

  const sortedTests = useMemo(() => [...tests].sort((a, b) => (a.date < b.date ? 1 : -1)), [tests]);

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Practice test (optional)">
          <select className={inputCls(t)} value={testId} onChange={(e) => handleTestSelect(e.target.value)}>
            <option value="">General, no specific test</option>
            {sortedTests.map((tst) => <option key={tst.id} value={tst.id}>{tst.name} ({fmtDate(tst.date)})</option>)}
          </select>
        </Field>
        <Field label="Date">
          <input type="date" className={inputCls(t)} value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Section">
          <select className={inputCls(t)} value={section} onChange={(e) => setSection(e.target.value)}>
            <option value={SECTION_MATH}>Math</option>
            <option value={SECTION_RW}>Reading & Writing</option>
          </select>
        </Field>
        <Field label="Domain">
          <select className={inputCls(t)} value={domain} onChange={(e) => setDomain(e.target.value)}>
            {DOMAINS[section].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Topic" hint="Pick a suggestion or type your own">
        <input list="topic-suggestions" className={inputCls(t)} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Linear inequalities" />
        <datalist id="topic-suggestions">
          {(TOPICS[domain] || []).map((tp) => <option key={tp} value={tp} />)}
        </datalist>
      </Field>
      <Field label="What happened">
        <textarea rows={2} className={inputCls(t)} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the mistake you made" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Reason">
          <select className={inputCls(t)} value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Difficulty">
          <select className={inputCls(t)} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
      </div>
      {reason === 'Other' && (
        <Field label="Specify the reason">
          <input className={inputCls(t)} value={reasonOther} onChange={(e) => setReasonOther(e.target.value)} />
        </Field>
      )}
      <Field label="Correct explanation" hint="How to solve it, or the rule that applies">
        <textarea rows={2} className={inputCls(t)} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      </Field>
      <Field label="Status">
        <select className={inputCls(t)} value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit">{initial ? 'Save changes' : 'Log mistake'}</Button>
      </div>
    </form>
  );
}

function TargetForm({ config, onSave }) {
  const t = useTheme();
  const [vals, setVals] = useState({ targetTotal: config.targetTotal, targetMath: config.targetMath, targetRW: config.targetRW });
  useEffect(() => {
    setVals({ targetTotal: config.targetTotal, targetMath: config.targetMath, targetRW: config.targetRW });
  }, [config.targetTotal, config.targetMath, config.targetRW]);

  function submit(e) {
    e.preventDefault();
    onSave({
      targetTotal: clamp(Number(vals.targetTotal) || 400, 400, 1600),
      targetMath: clamp(Number(vals.targetMath) || 200, 200, 800),
      targetRW: clamp(Number(vals.targetRW) || 200, 200, 800),
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
      <Field label="Target total score">
        <input type="number" min={400} max={1600} step={10} value={vals.targetTotal} onChange={(e) => setVals((v) => ({ ...v, targetTotal: e.target.value }))} className={inputCls(t)} />
      </Field>
      <Field label="Target Math score">
        <input type="number" min={200} max={800} step={10} value={vals.targetMath} onChange={(e) => setVals((v) => ({ ...v, targetMath: e.target.value }))} className={inputCls(t)} />
      </Field>
      <Field label="Target R&W score">
        <input type="number" min={200} max={800} step={10} value={vals.targetRW} onChange={(e) => setVals((v) => ({ ...v, targetRW: e.target.value }))} className={inputCls(t)} />
      </Field>
      <div className="sm:col-span-3">
        <Button type="submit">Save goals</Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  Pages: Dashboard                                                    */
/* ------------------------------------------------------------------ */

/**
 * Current/longest streak indicator. The 0-day state is deliberately styled
 * the same as any other neutral chip (not a broken-looking red/empty state)
 * with encouraging copy instead of "0 days", so a brand-new user doesn't
 * feel like something failed to load.
 */
function StreakBadge({ streak, size = 'md', forceDark = false }) {
  const t = useTheme();
  const [bump, setBump] = useState(false);
  const prevRef = useRef(streak.currentStreak);

  useEffect(() => {
    if (streak.currentStreak > prevRef.current) {
      setBump(true);
      const timer = setTimeout(() => setBump(false), 650);
      prevRef.current = streak.currentStreak;
      return () => clearTimeout(timer);
    }
    prevRef.current = streak.currentStreak;
    return undefined;
  }, [streak.currentStreak]);

  const active = streak.currentStreak > 0;
  const sizeCls = size === 'sm' ? 'gap-1.5 px-2.5 py-1 text-xs' : 'gap-2 px-3.5 py-2 text-sm';
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  // forceDark is for the sidebar, which is always a fixed dark navy panel
  // regardless of the light/dark theme toggle - it needs its own fixed
  // palette rather than the light/dark theme tokens, which would produce
  // low-contrast (e.g. slate-200-on-navy) results in light mode.
  const toneCls = forceDark
    ? (active ? 'border-amber-500/30 bg-amber-500/15 text-amber-400' : 'border-slate-700 text-slate-500')
    : active
      ? (t.dark ? 'border-amber-500/30 bg-amber-500/15 text-amber-400' : 'border-amber-200 bg-amber-50 text-amber-700')
      : `${t.border} ${t.textFaint}`;
  const longestCls = forceDark ? 'text-slate-500' : t.textFaint;

  return (
    <div
      className={`inline-flex items-center rounded-full border ${sizeCls} ${toneCls} ${bump ? 'sb-streak-bump' : ''}`}
      title={streak.longestStreak > 0 ? `Longest streak: ${streak.longestStreak} day${streak.longestStreak === 1 ? '' : 's'}` : 'Do something in Scorebook today to start a streak'}
    >
      <Flame className={`${iconSize} ${active ? 'fill-current' : ''}`} />
      <span className="font-semibold tabular-nums" style={size === 'sm' ? undefined : MONO}>
        {active ? `${streak.currentStreak} day${streak.currentStreak === 1 ? '' : 's'}` : 'Start a streak'}
      </span>
      {size !== 'sm' && streak.longestStreak > 0 && (
        <span className={`font-normal ${longestCls}`}>· longest {streak.longestStreak}</span>
      )}
    </div>
  );
}

function Dashboard({ tests, errors, config, streak, onLoadDemo, goToTests }) {
  const t = useTheme();
  const sortedTests = useMemo(() => [...tests].sort((a, b) => (a.date < b.date ? -1 : 1)), [tests]);
  const latest = sortedTests[sortedTests.length - 1];
  const prev = sortedTests[sortedTests.length - 2];
  const stats = useMemo(() => topicStats(errors), [errors]);
  // Exclude topics that are already fully mastered so a mastered topic never
  // shows up labeled as "weakest" just to fill out the list.
  const weakest = useMemo(
    () => stats.filter((s) => s.unreviewed + s.reviewing > 0).sort((a, b) => b.score - a.score).slice(0, 5),
    [stats],
  );
  const chartData = useMemo(() => sortedTests.map((tst) => ({ label: fmtShort(tst.date), Total: tst.totalScore, Math: tst.mathScore, 'R&W': tst.rwScore })), [sortedTests]);

  if (tests.length === 0 && errors.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl" style={SERIF}>Dashboard</h1>
            <p className={`mt-1 text-sm ${t.textMuted}`}>A running scoreboard for your Digital SAT prep.</p>
          </div>
          <StreakBadge streak={streak} />
        </div>
        <EmptyState
          icon={Sparkles}
          title="Your dashboard is empty"
          description="Add a practice test to start tracking your score, or explore the app first with realistic sample data."
          action={(
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={onLoadDemo}><Sparkles className="h-4 w-4" />Load demo data</Button>
              <Button variant="secondary" onClick={goToTests}>Add a practice test</Button>
            </div>
          )}
        />
      </div>
    );
  }

  const total = latest ? latest.totalScore : null;
  const math = latest ? latest.mathScore : null;
  const rw = latest ? latest.rwScore : null;
  const deltaTotal = (latest && prev) ? latest.totalScore - prev.totalScore : null;
  const pointsRemaining = total != null ? config.targetTotal - total : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl" style={SERIF}>Dashboard</h1>
          <p className={`mt-1 text-sm ${t.textMuted}`}>{config.userName ? `Welcome back, ${config.userName}.` : 'A running scoreboard for your Digital SAT prep.'}</p>
        </div>
        <StreakBadge streak={streak} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total score"
          value={total != null ? total : '—'}
          sub={deltaTotal != null ? `${deltaTotal >= 0 ? '+' : ''}${deltaTotal} vs last test` : (total != null ? 'First test logged' : undefined)}
          subTone={deltaTotal != null ? (deltaTotal >= 0 ? 'text-emerald-600' : 'text-rose-600') : undefined}
        />
        <StatCard label="Math score" value={math != null ? math : '—'} />
        <StatCard label="Reading & Writing score" value={rw != null ? rw : '—'} />
        <StatCard
          label="Target score"
          value={config.targetTotal}
          sub={pointsRemaining != null ? (pointsRemaining <= 0 ? 'Target reached' : `${pointsRemaining} points to go`) : 'Add a test to compare'}
          subTone={pointsRemaining != null && pointsRemaining <= 0 ? 'text-emerald-600' : t.textMuted}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Practice tests logged" value={tests.length} />
        <StatCard label="Errors logged" value={errors.length} />
        <div className={`rounded-xl border p-5 sm:col-span-2 ${t.card}`}>
          <div className={`text-sm font-medium ${t.textMuted}`}>Weakest topics</div>
          {weakest.length === 0 ? (
            <p className={`mt-3 text-sm ${t.textFaint}`}>Log mistakes in the Error Log to surface weak topics here.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {weakest.map((s) => (
                <div key={s.topic + s.domain + s.section} className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm">{s.topic}</span>
                  <Badge tone={s.section === SECTION_MATH ? 'indigo' : 'sky'}>{s.total}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Card title="Score progression" subtitle="Total, Math, and Reading & Writing across every logged test">
        <ScoreLineChart data={chartData} />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pages: Practice Tests                                               */
/* ------------------------------------------------------------------ */

function ScoreTriplet({ total, math, rw }) {
  const t = useTheme();
  return (
    <div className="flex items-center gap-5">
      <div className="text-right">
        <div className={`text-xs ${t.textFaint}`}>Total</div>
        <div className="text-lg font-semibold tabular-nums" style={MONO}>{total}</div>
      </div>
      <div className="text-right">
        <div className={`text-xs ${t.textFaint}`}>Math</div>
        <div className="text-sm tabular-nums" style={MONO}>{math}</div>
      </div>
      <div className="text-right">
        <div className={`text-xs ${t.textFaint}`}>R&W</div>
        <div className="text-sm tabular-nums" style={MONO}>{rw}</div>
      </div>
    </div>
  );
}

function PracticeTests({ tests, onAdd, onEdit, onDelete }) {
  const t = useTheme();
  const [modal, setModal] = useState(null);
  const sorted = useMemo(() => [...tests].sort((a, b) => (a.date < b.date ? 1 : -1)), [tests]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl" style={SERIF}>Practice tests</h1>
          <p className={`mt-1 text-sm ${t.textMuted}`}>Log every full-length practice test to track your trajectory.</p>
        </div>
        <Button onClick={() => setModal('add')}><Plus className="h-4 w-4" />Add practice test</Button>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No practice tests yet"
          description="Add your first practice test to start tracking your score over time."
          action={<Button onClick={() => setModal('add')}><Plus className="h-4 w-4" />Add practice test</Button>}
        />
      ) : (
        <div className="space-y-3">
          {sorted.map((tst) => (
            <div key={tst.id} className={`rounded-xl border p-5 ${t.card}`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold" style={SERIF}>{tst.name}</h3>
                  <p className={`mt-0.5 text-sm ${t.textMuted}`}>{fmtDate(tst.date)}</p>
                  {tst.notes && <p className={`mt-2 max-w-xl text-sm ${t.textMuted}`}>{tst.notes}</p>}
                </div>
                <div className="flex items-center gap-4">
                  <ScoreTriplet total={tst.totalScore} math={tst.mathScore} rw={tst.rwScore} />
                  <div className="flex items-center gap-1">
                    <IconButton icon={Pencil} label="Edit test" onClick={() => setModal({ edit: tst })} />
                    <IconButton icon={Trash2} label="Delete test" tone="danger" onClick={() => onDelete(tst.id)} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'add' ? 'Add practice test' : 'Edit practice test'}>
        {modal && (
          <TestForm
            initial={modal === 'add' ? null : modal.edit}
            onCancel={() => setModal(null)}
            onSubmit={(data) => { if (modal === 'add') onAdd(data); else onEdit(modal.edit.id, data); setModal(null); }}
          />
        )}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pages: Error Log                                                    */
/* ------------------------------------------------------------------ */

function AnalyzeMistakeBlock({ errorId }) {
  const t = useTheme();
  const [state, setState] = useState('idle'); // idle | loading | ready | error
  const [analysis, setAnalysis] = useState(null);
  const [errMsg, setErrMsg] = useState('');
  const [refreshNote, setRefreshNote] = useState('');

  async function run(forceRefresh) {
    setState('loading');
    setErrMsg('');
    setRefreshNote('');
    try {
      const data = await analyzeMistakeApi(errorId, forceRefresh);
      setAnalysis(data.analysis);
      setState('ready');
      if (forceRefresh && data.upToDate) {
        setRefreshNote("Nothing's changed on this mistake since last time.");
        setTimeout(() => setRefreshNote(''), 5000);
      }
    } catch (err) {
      setErrMsg(err.message || 'Could not analyze this mistake.');
      setState('error');
    }
  }

  if (state === 'idle') {
    return (
      <div className="pt-1">
        <Button variant="secondary" size="sm" onClick={() => run(false)}>
          <Lightbulb className="h-4 w-4" />Analyze mistake
        </Button>
      </div>
    );
  }
  if (state === 'loading') {
    return (
      <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${t.textMuted} ${t.border}`}>
        <Loader2 className="h-4 w-4 animate-spin" />Analyzing this mistake...
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="space-y-2">
        <p className="text-sm text-rose-600">{errMsg}</p>
        <Button variant="secondary" size="sm" onClick={() => run(false)}>Try again</Button>
      </div>
    );
  }
  return (
    <div className={`space-y-3 rounded-lg border p-4 ${t.dark ? 'border-amber-900/40 bg-amber-950/20' : 'border-amber-200 bg-amber-50'}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-sm font-semibold"><Lightbulb className="h-4 w-4" />AI explanation</span>
        <Button variant="ghost" size="sm" onClick={() => run(true)}><RefreshCw className="h-3.5 w-3.5" />Re-analyze</Button>
      </div>
      {refreshNote && <p className={`text-xs ${t.textFaint}`}>{refreshNote}</p>}
      <div><span className={`text-xs font-medium ${t.textMuted}`}>Skill tested</span><p className="text-sm">{analysis.skillTested}</p></div>
      <div><span className={`text-xs font-medium ${t.textMuted}`}>What happened</span><p className="text-sm">{analysis.mistakeExplanation}</p></div>
      <div><span className={`text-xs font-medium ${t.textMuted}`}>Likely mistake type</span><p className="text-sm">{analysis.likelyMistakeType}</p></div>
      {analysis.howToFix.length > 0 && (
        <div>
          <span className={`text-xs font-medium ${t.textMuted}`}>How to fix it</span>
          <ul className="mt-1 list-inside list-disc space-y-1 text-sm">
            {analysis.howToFix.map((step, i) => <li key={i}>{step}</li>)}
          </ul>
        </div>
      )}
      {analysis.rememberThis && (
        <div><span className={`text-xs font-medium ${t.textMuted}`}>Remember this</span><p className="text-sm">{analysis.rememberThis}</p></div>
      )}
      <div><span className={`text-xs font-medium ${t.textMuted}`}>Related pattern</span><p className="text-sm">{analysis.relatedPattern}</p></div>
    </div>
  );
}

/**
 * Turns the plain-text math notation the practice-question prompt asks the
 * model for (x^2, x_1, \sqrt{16}, \frac{a}{b}) into actual superscripts,
 * subscripts, radicals, and stacked fractions, instead of showing the raw
 * caret/underscore/backslash characters verbatim. Deliberately a small
 * hand-written parser rather than a full LaTeX engine (no new dependency,
 * and the prompt only asks the model for this small, fixed vocabulary of
 * constructs) - see PRACTICE_QUESTION_SYSTEM_PROMPT in prompts.js for the
 * exact notation this is built to match.
 *
 * Unlike a flat regex, this walks the string with proper brace matching, so
 * \frac and \sqrt can contain each other (e.g. \frac{7+\sqrt{29}}{2}, the
 * quadratic formula) instead of only matching when their contents have no
 * braces at all.
 *
 * The leading backslash on \sqrt/\frac is optional here (matching
 * "sqrt{...}"/"frac{...}" too) as a defensive fallback for whenever the
 * model drops it despite being told not to - the prompt is the source of
 * truth, this is just a safety net. SYMBOL_REPLACEMENTS is the same kind of
 * safety net for a small set of other LaTeX commands models sometimes slip
 * in (\ge, \le, \pm, \times, \pi, ...) even though the prompt says to use
 * plain ASCII instead - these render as their real symbol rather than
 * showing the raw backslash command.
 */
const SYMBOL_REPLACEMENTS = [
  ['\\geq', '\u2265'], ['\\leq', '\u2264'], ['\\neq', '\u2260'],
  ['\\times', '\u00d7'], ['\\approx', '\u2248'], ['\\infty', '\u221e'],
  ['\\degree', '\u00b0'], ['\\alpha', '\u03b1'], ['\\theta', '\u03b8'],
  ['\\circ', '\u00b0'], ['\\div', '\u00f7'], ['\\pi', '\u03c0'],
  ['\\pm', '\u00b1'], ['\\mp', '\u2213'], ['\\cdot', '\u00b7'],
  ['\\ge', '\u2265'], ['\\le', '\u2264'], ['\\ne', '\u2260'],
];

const PLAIN_SUP_SUB = /^-?[A-Za-z0-9.]+/;

// Finds the matching closing brace/paren for the one at text[openIndex],
// counting nested pairs so e.g. \frac{7+\sqrt{29}}{2} finds the outer "}"
// that actually closes the numerator, not the inner sqrt's.
function findBalanced(text, openIndex, openCh, closeCh) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === openCh) depth++;
    else if (text[i] === closeCh) {
      depth--;
      if (depth === 0) return { inner: text.slice(openIndex + 1, i), nextIndex: i + 1 };
    }
  }
  return null;
}

function renderMathNodes(text, keyRef) {
  const nodes = [];
  let i = 0;
  let buffer = '';
  const flush = () => { if (buffer) { nodes.push(buffer); buffer = ''; } };

  while (i < text.length) {
    if (text.startsWith('\\frac{', i) || text.startsWith('frac{', i)) {
      const braceStart = text.indexOf('{', i);
      const num = findBalanced(text, braceStart, '{', '}');
      if (num && text[num.nextIndex] === '{') {
        const den = findBalanced(text, num.nextIndex, '{', '}');
        if (den) {
          flush();
          nodes.push(
            <span key={keyRef.k++} className="mx-0.5 inline-flex flex-col items-center align-middle text-[0.85em] leading-tight">
              <span className="px-0.5">{renderMathNodes(num.inner, keyRef)}</span>
              <span className="w-full border-t border-current px-0.5">{renderMathNodes(den.inner, keyRef)}</span>
            </span>,
          );
          i = den.nextIndex;
          continue;
        }
      }
    }

    if (text.startsWith('\\sqrt{', i) || text.startsWith('sqrt{', i)) {
      const braceStart = text.indexOf('{', i);
      const grp = findBalanced(text, braceStart, '{', '}');
      if (grp) {
        flush();
        nodes.push(
          <span key={keyRef.k++} className="whitespace-nowrap">
            &radic;<span className="border-t border-current px-0.5">{renderMathNodes(grp.inner, keyRef)}</span>
          </span>,
        );
        i = grp.nextIndex;
        continue;
      }
    }

    if (text.startsWith('\\sqrt(', i) || text.startsWith('sqrt(', i)) {
      const parenStart = text.indexOf('(', i);
      const grp = findBalanced(text, parenStart, '(', ')');
      if (grp) {
        flush();
        nodes.push(
          <span key={keyRef.k++} className="whitespace-nowrap">
            &radic;<span className="border-t border-current px-0.5">{renderMathNodes(grp.inner, keyRef)}</span>
          </span>,
        );
        i = grp.nextIndex;
        continue;
      }
    }

    const ch = text[i];
    if (ch === '^' || ch === '_') {
      if (text[i + 1] === '{') {
        const grp = findBalanced(text, i + 1, '{', '}');
        if (grp) {
          flush();
          const rendered = renderMathNodes(grp.inner, keyRef);
          nodes.push(ch === '^' ? <sup key={keyRef.k++}>{rendered}</sup> : <sub key={keyRef.k++}>{rendered}</sub>);
          i = grp.nextIndex;
          continue;
        }
      } else {
        const m = PLAIN_SUP_SUB.exec(text.slice(i + 1));
        if (m) {
          flush();
          nodes.push(ch === '^' ? <sup key={keyRef.k++}>{m[0]}</sup> : <sub key={keyRef.k++}>{m[0]}</sub>);
          i += 1 + m[0].length;
          continue;
        }
      }
    }

    // Defensive fallback for stray $...$ / $$...$$ math delimiters some
    // models add out of habit despite being told not to (this app has no
    // LaTeX renderer, so a bare $ would otherwise show up literally) - only
    // treated as a delimiter pair when there's no whitespace before the
    // closing $, so an ordinary price like "$5 to $10" is left alone.
    if (ch === '$') {
      let end = -1;
      for (let k = i + 1; k < text.length; k++) {
        if (text[k] === ' ' || text[k] === '\n') break;
        if (text[k] === '$') { end = k; break; }
      }
      if (end > i + 1) {
        flush();
        nodes.push(...renderMathNodes(text.slice(i + 1, end), keyRef));
        i = end + 1;
        continue;
      }
    }

    if (ch === '\\') {
      const hit = SYMBOL_REPLACEMENTS.find(([token]) => text.startsWith(token, i));
      if (hit) {
        buffer += hit[1];
        i += hit[0].length;
        continue;
      }
    }

    buffer += ch;
    i += 1;
  }
  flush();
  return nodes;
}

function renderMathText(text) {
  if (!text) return text;
  return renderMathNodes(text, { k: 0 });
}

function MathText({ text, className }) {
  return <span className={className}>{renderMathText(text)}</span>;
}

/**
 * "Practice a similar question" for a logged mistake. Talks to
 * /api/practice-question, which serves an unseen question from the shared
 * pool when one exists (no Groq call, no quota impact) and only generates a
 * new one via Groq once the pool is exhausted for this category - see that
 * route for the full flow. `quota`/`onQuotaUpdate` are lifted to ErrorLog so
 * the "N of 10 left today" indicator stays in sync across every mistake's
 * card, not just the one most recently used.
 */
function PracticeQuestionBlock({ err, quota, onQuotaUpdate }) {
  const t = useTheme();
  const [state, setState] = useState('idle'); // idle | loading | ready | empty | error
  const [result, setResult] = useState(null); // { question, source, message, warning }
  const [errMsg, setErrMsg] = useState('');
  const [selected, setSelected] = useState(null);
  const [revealed, setRevealed] = useState(false);

  async function run() {
    setState('loading');
    setErrMsg('');
    setSelected(null);
    setRevealed(false);
    try {
      const data = await requestPracticeQuestion(err.id, todayIso());
      if (data.quota) onQuotaUpdate(data.quota);
      setResult(data);
      setState(data.question ? 'ready' : 'empty');
    } catch (e) {
      setErrMsg(e.message || 'Could not get a practice question.');
      setState('error');
    }
  }

  if (state === 'idle') {
    return (
      <div className="space-y-1.5 pt-1">
        <Button variant="secondary" size="sm" onClick={run}>
          <Sparkles className="h-4 w-4" />Practice a similar question
        </Button>
        {quota && <p className={`text-xs ${t.textFaint}`}>{quota.remaining} of {quota.max} new practice questions left today</p>}
      </div>
    );
  }
  if (state === 'loading') {
    return (
      <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${t.textMuted} ${t.border}`}>
        <Loader2 className="h-4 w-4 animate-spin" />Finding a practice question...
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="space-y-2">
        <p className="text-sm text-rose-600">{errMsg}</p>
        <Button variant="secondary" size="sm" onClick={run}>Try again</Button>
      </div>
    );
  }
  if (state === 'empty') {
    return (
      <div className="space-y-2">
        <p className={`text-sm ${t.textMuted}`}>{result?.message || "You're out of practice questions for today. Try again tomorrow."}</p>
        <Button variant="ghost" size="sm" onClick={() => setState('idle')}>Dismiss</Button>
      </div>
    );
  }

  const q = result.question;
  const choices = q.choices || [];
  return (
    <div className={`space-y-3 rounded-lg border p-4 ${t.dark ? 'border-indigo-900/40 bg-indigo-950/20' : 'border-indigo-200 bg-indigo-50'}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4" />Practice question</span>
        <Button variant="ghost" size="sm" onClick={run}><RefreshCw className="h-3.5 w-3.5" />Get another</Button>
      </div>
      {(result.message || result.warning) && <p className={`text-xs ${t.textFaint}`}>{result.message || result.warning}</p>}
      {quota && <p className={`text-xs ${t.textFaint}`}>{quota.remaining} of {quota.max} new practice questions left today</p>}
      <p className="text-sm"><MathText text={q.stem} /></p>
      <div className="space-y-1.5">
        {choices.map((c) => {
          const isCorrect = c.id === q.correctChoiceId;
          const isSelected = c.id === selected;
          let toneCls = `${t.border} ${t.hoverSubtle}`;
          if (revealed && isCorrect) toneCls = t.dark ? 'border-emerald-600 bg-emerald-500/10' : 'border-emerald-400 bg-emerald-50';
          else if (revealed && isSelected) toneCls = t.dark ? 'border-rose-700 bg-rose-500/10' : 'border-rose-300 bg-rose-50';
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => { setSelected(c.id); setRevealed(true); }}
              disabled={revealed}
              className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default ${toneCls}`}
            >
              <span className="font-semibold">{c.id}.</span>
              <span><MathText text={c.text} /></span>
            </button>
          );
        })}
      </div>
      {revealed && (
        <div className="space-y-1 pt-1">
          <p className="text-sm font-medium">
            {selected === q.correctChoiceId ? 'Correct!' : `Not quite — the correct answer is ${q.correctChoiceId}.`}
          </p>
          {q.explanation && <p className={`text-sm ${t.textMuted}`}><MathText text={q.explanation} /></p>}
        </div>
      )}
    </div>
  );
}

function ErrorCard({ err, testName, expanded, onToggle, onEdit, onDelete, onStatusChange, quota, onQuotaUpdate }) {
  const t = useTheme();
  return (
    <div className={`rounded-xl border ${t.card}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-start justify-between gap-4 p-5 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={err.section === SECTION_MATH ? 'indigo' : 'sky'}>{err.section}</Badge>
            <Badge tone="neutral">{err.domain}</Badge>
            <Badge tone={statusTone(err.status)}>{err.status}</Badge>
          </div>
          <h3 className="mt-2 text-base font-semibold" style={SERIF}>{err.topic}</h3>
          <p
            className={`mt-1 text-sm ${t.textMuted}`}
            style={expanded ? undefined : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          >
            {err.description}
          </p>
          <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs ${t.textFaint}`}>
            <span>{fmtDate(err.date)}</span>
            <span>{testName}</span>
            <span>{err.difficulty}</span>
          </div>
        </div>
        <ChevronDown className={`mt-1 h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''} ${t.textFaint}`} />
      </button>
      {expanded && (
        <div className={`space-y-3 border-t px-5 py-4 ${t.border}`}>
          <div>
            <span className={`text-xs font-medium ${t.textMuted}`}>Reason</span>
            <p className="text-sm">{err.reason}</p>
          </div>
          {err.explanation && (
            <div>
              <span className={`text-xs font-medium ${t.textMuted}`}>Correct approach</span>
              <p className="text-sm">{err.explanation}</p>
            </div>
          )}
          <AnalyzeMistakeBlock errorId={err.id} />
          <PracticeQuestionBlock err={err} quota={quota} onQuotaUpdate={onQuotaUpdate} />
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <select value={err.status} onChange={(e) => onStatusChange(e.target.value)} className={`${inputCls(t)} w-auto`}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="flex items-center gap-1">
              <IconButton icon={Pencil} label="Edit error" onClick={onEdit} />
              <IconButton icon={Trash2} label="Delete error" tone="danger" onClick={onDelete} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ErrorLog({ errors, tests, onAdd, onEdit, onDelete }) {
  const t = useTheme();
  const [modal, setModal] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [filters, setFilters] = useState({ section: 'All', domain: 'All', status: 'All', difficulty: 'All', q: '' });
  // Lifted above individual ErrorCards so the "N of 10 left today" quota
  // indicator stays consistent no matter which mistake's card last made a
  // practice-question request - it's a per-user daily limit, not per-card.
  const [quota, setQuota] = useState(null);

  const domainOptions = filters.section === 'All' ? [...DOMAINS[SECTION_MATH], ...DOMAINS[SECTION_RW]] : DOMAINS[filters.section];

  const filtered = useMemo(() => {
    return [...errors].sort((a, b) => (a.date < b.date ? 1 : -1)).filter((e) => {
      if (filters.section !== 'All' && e.section !== filters.section) return false;
      if (filters.domain !== 'All' && e.domain !== filters.domain) return false;
      if (filters.status !== 'All' && e.status !== filters.status) return false;
      if (filters.difficulty !== 'All' && e.difficulty !== filters.difficulty) return false;
      if (filters.q.trim()) {
        const q = filters.q.trim().toLowerCase();
        const hay = `${e.topic} ${e.description} ${e.reason} ${e.domain}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [errors, filters]);

  function testNameFor(id) {
    if (!id) return 'General';
    const tst = tests.find((x) => x.id === id);
    return tst ? tst.name : 'General';
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl" style={SERIF}>Error log</h1>
          <p className={`mt-1 text-sm ${t.textMuted}`}>Every mistake is a data point. Log it once, review it until it sticks.</p>
        </div>
        <Button onClick={() => setModal('add')}><Plus className="h-4 w-4" />Log a mistake</Button>
      </div>

      {errors.length > 0 && (
        <Card title="Filters">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <select value={filters.section} onChange={(e) => setFilters((f) => ({ ...f, section: e.target.value, domain: 'All' }))} className={inputCls(t)}>
              <option value="All">All sections</option>
              <option value={SECTION_MATH}>Math</option>
              <option value={SECTION_RW}>Reading & Writing</option>
            </select>
            <select value={filters.domain} onChange={(e) => setFilters((f) => ({ ...f, domain: e.target.value }))} className={inputCls(t)}>
              <option value="All">All domains</option>
              {domainOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className={inputCls(t)}>
              <option value="All">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filters.difficulty} onChange={(e) => setFilters((f) => ({ ...f, difficulty: e.target.value }))} className={inputCls(t)}>
              <option value="All">All difficulties</option>
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <div className="relative">
              <Search className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${t.textFaint}`} />
              <input value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} placeholder="Search errors" className={`${inputCls(t)} pl-9`} />
            </div>
          </div>
          <p className={`mt-3 text-sm ${t.textMuted}`}>{filtered.length} of {errors.length} errors</p>
        </Card>
      )}

      {errors.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="No mistakes logged yet"
          description="Log your SAT mistakes as you review practice tests to build a searchable record of what to fix."
          action={<Button onClick={() => setModal('add')}><Plus className="h-4 w-4" />Log a mistake</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Search} title="No errors match these filters" description="Try adjusting or clearing your filters." />
      ) : (
        <div className="space-y-3">
          {filtered.map((err) => (
            <ErrorCard
              key={err.id}
              err={err}
              testName={testNameFor(err.testId)}
              expanded={expanded === err.id}
              onToggle={() => setExpanded((x) => (x === err.id ? null : err.id))}
              onEdit={() => setModal({ edit: err })}
              onDelete={() => onDelete(err.id)}
              onStatusChange={(s) => onEdit(err.id, { ...err, status: s })}
              quota={quota}
              onQuotaUpdate={setQuota}
            />
          ))}
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'add' ? 'Log a mistake' : 'Edit error'} wide>
        {modal && (
          <ErrorForm
            initial={modal === 'add' ? null : modal.edit}
            tests={tests}
            onCancel={() => setModal(null)}
            onSubmit={(data) => { if (modal === 'add') onAdd(data); else onEdit(modal.edit.id, data); setModal(null); }}
          />
        )}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pages: Analytics                                                    */
/* ------------------------------------------------------------------ */

function Analytics({ tests, errors }) {
  const t = useTheme();
  const sortedTests = useMemo(() => [...tests].sort((a, b) => (a.date < b.date ? -1 : 1)), [tests]);
  const chartData = useMemo(() => sortedTests.map((tst) => ({ label: fmtShort(tst.date), Total: tst.totalScore, Math: tst.mathScore, 'R&W': tst.rwScore })), [sortedTests]);
  const mathSeries = useMemo(() => chartData.map((d) => ({ label: d.label, Math: d.Math })), [chartData]);
  const rwSeries = useMemo(() => chartData.map((d) => ({ label: d.label, 'R&W': d['R&W'] })), [chartData]);

  const bySection = useMemo(() => ([
    { name: 'Math', value: errors.filter((e) => e.section === SECTION_MATH).length },
    { name: 'Reading & Writing', value: errors.filter((e) => e.section === SECTION_RW).length },
  ]), [errors]);
  const byDomain = useMemo(() => byDomainWithSection(errors), [errors]);
  const byTopic = useMemo(() => byTopicWithSection(errors), [errors]);
  const byReason = useMemo(() => byKey(errors, 'reason').slice(0, 8), [errors]);
  const statusCounts = useMemo(() => ({
    unreviewed: errors.filter((e) => e.status === 'Unreviewed').length,
    reviewing: errors.filter((e) => e.status === 'Reviewing').length,
    mastered: errors.filter((e) => e.status === 'Mastered').length,
  }), [errors]);
  const weakest = useMemo(() => topicStats(errors).sort((a, b) => b.score - a.score).slice(0, 8), [errors]);
  const scoreDelta = sortedTests.length >= 2 ? sortedTests[sortedTests.length - 1].totalScore - sortedTests[0].totalScore : null;

  if (tests.length === 0 && errors.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl" style={SERIF}>Analytics</h1>
          <p className={`mt-1 text-sm ${t.textMuted}`}>Patterns across your tests and mistakes, once you have some logged.</p>
        </div>
        <EmptyState icon={BarChart3} title="Nothing to analyze yet" description="Add a few practice tests and log some mistakes to unlock analytics." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl" style={SERIF}>Analytics</h1>
        <p className={`mt-1 text-sm ${t.textMuted}`}>Patterns across your tests and mistakes.</p>
      </div>

      {sortedTests.length > 0 && (
        <Card title="Score progression" subtitle={scoreDelta != null ? `${scoreDelta >= 0 ? '+' : ''}${scoreDelta} points since your first test` : 'Log another test to see your trend'}>
          <ScoreLineChart data={chartData} />
        </Card>
      )}

      {sortedTests.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Math progression"><MiniLineChart data={mathSeries} dataKey="Math" color={CHART_COLORS.math} /></Card>
          <Card title="Reading & Writing progression"><MiniLineChart data={rwSeries} dataKey="R&W" color={CHART_COLORS.rw} /></Card>
        </div>
      )}

      {errors.length > 0 ? (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Errors by section"><RankedBarChart data={bySection} colors={[CHART_COLORS.math, CHART_COLORS.rw]} height={140} /></Card>
            <Card title="Mastery breakdown" subtitle="Across every logged error"><MasterySegmentedBar unreviewed={statusCounts.unreviewed} reviewing={statusCounts.reviewing} mastered={statusCounts.mastered} /></Card>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Errors by domain"><RankedBarChart data={byDomain} colors={byDomain.map((d) => (d.section === SECTION_MATH ? CHART_COLORS.math : CHART_COLORS.rw))} height={Math.max(160, byDomain.length * 36)} /></Card>
            <Card title="Errors by topic" subtitle="Top 8 by number of logged mistakes"><RankedBarChart data={byTopic} colors={byTopic.map((d) => (d.section === SECTION_MATH ? CHART_COLORS.math : CHART_COLORS.rw))} height={Math.max(160, byTopic.length * 36)} /></Card>
          </div>
          <Card title="Most common mistake reasons"><RankedBarChart data={byReason} color={CHART_COLORS.reason} height={Math.max(160, byReason.length * 36)} /></Card>
          <Card title="Weakest topics" subtitle="Ranked by how much attention each topic needs">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className={t.textFaint}>Topic</span>
              <div className="flex gap-4">
                <span className={t.textFaint}>Total</span>
                <span className={t.textFaint}>New</span>
                <span className={t.textFaint}>Reviewing</span>
                <span className={t.textFaint}>Mastered</span>
              </div>
            </div>
            <div className="space-y-3">
              {weakest.map((s) => (
                <div key={s.topic + s.domain + s.section} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.topic}</p>
                    <p className={`text-xs ${t.textMuted}`}>{s.domain}</p>
                  </div>
                  <div className="flex shrink-0 gap-4 text-sm tabular-nums">
                    <span className={t.textMuted}>{s.total}</span>
                    <span className="text-rose-600">{s.unreviewed}</span>
                    <span className="text-amber-600">{s.reviewing}</span>
                    <span className="text-emerald-600">{s.mastered}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : (
        <Card title="Error analytics">
          <p className={`text-sm ${t.textMuted}`}>Log mistakes in the Error Log to unlock analytics on domains, topics, and mistake reasons.</p>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pages: AI Analysis                                                  */
/* ------------------------------------------------------------------ */

function dataMaturityBanner(maturity) {
  if (maturity === 'minimal') return 'We need more data to identify reliable recurring patterns yet — treat this as an early read.';
  if (maturity === 'developing') return 'Your profile is beginning to develop. More tests and logged mistakes will make pattern detection more reliable.';
  return null;
}

function TrendValue({ value, suffix = '' }) {
  const t = useTheme();
  if (value == null) return <span className={t.textFaint}>—</span>;
  if (value === 0) return <span className={`inline-flex items-center gap-1 ${t.textMuted}`}><Minus className="h-3.5 w-3.5" />0{suffix}</span>;
  const up = value > 0;
  return (
    <span className={`inline-flex items-center gap-1 ${up ? 'text-emerald-600' : 'text-rose-600'}`}>
      {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {up ? '+' : ''}{value}{suffix}
    </span>
  );
}

function ConfidenceBadge({ confidence }) {
  const tone = confidence === 'high' ? 'emerald' : confidence === 'medium' ? 'amber' : 'sky';
  return <Badge tone={tone}>{confidence} confidence</Badge>;
}
function SeverityBadge({ severity }) {
  const tone = severity === 'high' ? 'rose' : severity === 'medium' ? 'amber' : 'sky';
  return <Badge tone={tone}>{severity} priority</Badge>;
}
function ImprovementBadge({ status }) {
  const map = {
    improving: 'emerald', resolved: 'emerald', declining: 'rose', worsening: 'rose', new: 'indigo', stable: 'neutral',
  };
  return <Badge tone={map[status] || 'neutral'}>{status}</Badge>;
}

function SectionPerfCard({ label, data }) {
  const t = useTheme();
  return (
    <div className={`rounded-xl border p-5 ${t.card}`}>
      <div className={`text-sm font-medium ${t.textMuted}`}>{label}</div>
      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
        <div>
          <div className={`text-xs ${t.textFaint}`}>Latest</div>
          <div className="text-lg font-semibold tabular-nums" style={MONO}>{data.latestScore ?? '—'}</div>
        </div>
        <div>
          <div className={`text-xs ${t.textFaint}`}>Average</div>
          <div className="text-lg font-semibold tabular-nums" style={MONO}>{data.averageScore ?? '—'}</div>
        </div>
        <div>
          <div className={`text-xs ${t.textFaint}`}>Best</div>
          <div className="text-lg font-semibold tabular-nums" style={MONO}>{data.bestScore ?? '—'}</div>
        </div>
      </div>
      <div className="mt-3 text-sm"><TrendValue value={data.trend} /></div>
    </div>
  );
}

function AIAnalysis({ tests, errors, goToTests }) {
  const t = useTheme();
  const hasAnyData = tests.length > 0 || errors.length > 0;
  const [state, setState] = useState(hasAnyData ? 'loading' : 'empty');
  const [result, setResult] = useState(null);
  const [errMsg, setErrMsg] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState('');

  const load = useCallback(async (forceRefresh) => {
    if (forceRefresh) setRefreshing(true);
    else setState('loading');
    setErrMsg('');
    setRefreshNote('');
    try {
      const data = await fetchPerformanceAnalysis(forceRefresh);
      setResult(data);
      setState('ready');
      // Refresh was clicked but nothing has actually changed since the last
      // analysis - we didn't call the AI again, just say so instead of
      // silently doing nothing.
      if (forceRefresh && data.upToDate) {
        setRefreshNote("You're up to date - add a test or log a mistake to get a new analysis.");
        setTimeout(() => setRefreshNote(''), 5000);
      }
    } catch (err) {
      setErrMsg(err.message || 'Could not load your analysis.');
      setState('error');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (hasAnyData) load(false);
    // Intentionally runs once on mount; "Refresh Analysis" handles later updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl" style={SERIF}>AI Performance Analysis</h1>
        <p className={`mt-1 text-sm ${t.textMuted}`}>Your performance analyzed across your tests and mistakes.</p>
      </div>
      {state === 'ready' && (
        <div className="flex items-center gap-3">
          {result?.analyzedAt && (
            <span className={`text-xs ${t.textFaint}`}>Last analyzed: {fmtDate(result.analyzedAt.slice(0, 10))}</span>
          )}
          <Button variant="secondary" size="sm" onClick={() => load(true)} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {refreshing ? 'Refreshing...' : 'Refresh analysis'}
          </Button>
        </div>
      )}
      {refreshNote && <p className={`w-full text-right text-xs ${t.textFaint}`}>{refreshNote}</p>}
    </div>
  );

  if (state === 'empty') {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={Brain}
          title="No performance data yet"
          description="Complete your first test to start building your performance profile."
          action={<Button onClick={goToTests}>Add a practice test</Button>}
        />
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="space-y-6">
        {header}
        <div className={`flex items-center gap-3 rounded-xl border p-8 ${t.card}`}>
          <Loader2 className={`h-5 w-5 animate-spin ${t.textMuted}`} />
          <p className={`text-sm ${t.textMuted}`}>Analyzing your performance...</p>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="space-y-6">
        {header}
        <div className={`rounded-xl border p-8 text-center ${t.dark ? 'border-rose-900/50 bg-rose-950/30' : 'border-rose-200 bg-rose-50'}`}>
          <p className="text-sm text-rose-600">{errMsg}</p>
          <div className="mt-4"><Button variant="secondary" onClick={() => load(false)}>Try again</Button></div>
        </div>
      </div>
    );
  }

  const { analysis, profile, warning } = result;
  const banner = dataMaturityBanner(profile.dataMaturity);
  const byReasonData = (profile.mistakeReasons || []).map((r) => ({ name: r.name, value: r.count }));
  const byDifficultyData = (profile.difficultyDistribution || []).map((d) => ({ name: d.name, value: d.count }));

  return (
    <div className="space-y-6">
      {header}

      {warning && (
        <div className={`rounded-xl border p-4 text-sm ${t.dark ? 'border-amber-900/50 bg-amber-950/30 text-amber-400' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
          {warning}
        </div>
      )}
      {banner && <div className={`rounded-xl border p-4 text-sm ${t.textMuted} ${t.card}`}>{banner}</div>}

      <Card title="Overall performance">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <div><div className={`text-xs ${t.textFaint}`}>Latest score</div><div className="mt-1 text-2xl font-semibold tabular-nums" style={MONO}>{profile.overall.latestScore ?? '—'}</div></div>
          <div><div className={`text-xs ${t.textFaint}`}>Average score</div><div className="mt-1 text-2xl font-semibold tabular-nums" style={MONO}>{profile.overall.averageScore ?? '—'}</div></div>
          <div><div className={`text-xs ${t.textFaint}`}>Best score</div><div className="mt-1 text-2xl font-semibold tabular-nums" style={MONO}>{profile.overall.bestScore ?? '—'}</div></div>
          <div><div className={`text-xs ${t.textFaint}`}>Score trend</div><div className="mt-1 text-2xl font-semibold"><TrendValue value={profile.overall.scoreTrend} /></div></div>
          <div><div className={`text-xs ${t.textFaint}`}>Tests completed</div><div className="mt-1 text-2xl font-semibold tabular-nums" style={MONO}>{profile.overall.testsTaken}</div></div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <SectionPerfCard label="Math" data={profile.sections[SECTION_MATH]} />
        <SectionPerfCard label="Reading & Writing" data={profile.sections[SECTION_RW]} />
      </div>

      <Card title="AI summary">
        <div className="mb-3"><ConfidenceBadge confidence={analysis.overallAssessment.confidence} /></div>
        <p className="text-sm leading-relaxed">{analysis.overallAssessment.summary}</p>
      </Card>

      {analysis.strengths.length > 0 && (
        <Card title="Top strengths">
          <div className="grid gap-4 sm:grid-cols-2">
            {analysis.strengths.map((s, i) => (
              <div key={i} className={`rounded-lg border p-4 ${t.border}`}>
                <h4 className="text-sm font-semibold text-emerald-600">{s.title}</h4>
                <p className="mt-1.5 text-sm">{s.description}</p>
                {s.evidence && <p className={`mt-2 text-xs ${t.textFaint}`}>{s.evidence}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {analysis.weaknesses.length > 0 && (
        <Card title="Top weaknesses" subtitle="Ranked by priority — fix these first.">
          <div className="space-y-4">
            {analysis.weaknesses.map((w, i) => (
              <div key={i} className={`rounded-lg border p-4 ${t.border}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-sm font-semibold ${t.text}`}>{i + 1}. {w.title}</span>
                    {w.section && <Badge tone={w.section === SECTION_MATH ? 'indigo' : 'sky'}>{w.section}</Badge>}
                  </div>
                  <SeverityBadge severity={w.severity} />
                </div>
                <p className="mt-2 text-sm">{w.description}</p>
                {w.evidence && <p className={`mt-2 text-xs ${t.textFaint}`}>Evidence: {w.evidence}</p>}
                {w.whyItMatters && <p className={`mt-2 text-sm ${t.textMuted}`}>Why it matters: {w.whyItMatters}</p>}
                {w.howToImprove.length > 0 && (
                  <ul className="mt-3 list-inside list-disc space-y-1 text-sm">
                    {w.howToImprove.map((step, j) => <li key={j}>{step}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {analysis.recurringPatterns.length > 0 && (
        <Card title="Recurring mistakes">
          <div className="space-y-4">
            {analysis.recurringPatterns.map((p, i) => (
              <div key={i} className={`rounded-lg border p-4 ${t.border}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{p.title}</span>
                  <Badge tone="amber">{p.frequency} occurrence{p.frequency === 1 ? '' : 's'}</Badge>
                </div>
                <p className="mt-2 text-sm">{p.description}</p>
                {p.evidence && <p className={`mt-2 text-xs ${t.textFaint}`}>{p.evidence}</p>}
                {p.solution && <p className="mt-2 text-sm text-emerald-600">Fix: {p.solution}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="What improved" subtitle={!profile.improvementContext.hasPrevious ? 'First analysis — improvement tracking appears after your next refresh.' : undefined}>
        {analysis.improvement.length === 0 ? (
          <p className={`text-sm ${t.textFaint}`}>
            {profile.improvementContext.hasPrevious ? 'No notable changes since your last analysis.' : 'Come back after your next test or refresh to see how your weak areas are trending.'}
          </p>
        ) : (
          <div className="space-y-3">
            {analysis.improvement.map((imp, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-medium">{imp.area}</span>
                <div className="flex items-center gap-3">
                  <span className={`text-sm ${t.textMuted}`}>{imp.description}</span>
                  <ImprovementBadge status={imp.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {analysis.studyPriorities.length > 0 && (
        <Card title="What to study next">
          <div className="space-y-3">
            {analysis.studyPriorities.map((p, i) => (
              <div key={i} className={`rounded-lg border p-4 ${t.border}`}>
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-600 text-xs font-semibold text-white">{p.priority ?? i + 1}</span>
                  <span className="text-sm font-semibold">{p.topic}</span>
                </div>
                {p.reason && <p className="mt-2 text-sm">{p.reason}</p>}
                {p.recommendedPractice && <p className={`mt-1.5 text-sm ${t.textMuted}`}>{p.recommendedPractice}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {analysis.testStrategy.length > 0 && (
        <Card title="Test strategy">
          <ul className="list-inside list-disc space-y-1.5 text-sm">
            {analysis.testStrategy.map((tip, i) => <li key={i}>{tip}</li>)}
          </ul>
        </Card>
      )}

      {(byReasonData.length > 0 || byDifficultyData.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {byReasonData.length > 0 && (
            <Card title="Mistake reasons" subtitle="Deterministic count from your logged mistakes.">
              <RankedBarChart data={byReasonData} color={CHART_COLORS.reason} height={Math.max(160, byReasonData.length * 36)} />
            </Card>
          )}
          {byDifficultyData.length > 0 && (
            <Card title="Mistake difficulty" subtitle="Difficulty of logged mistakes only, not overall accuracy.">
              <RankedBarChart data={byDifficultyData} color={CHART_COLORS.total} height={Math.max(160, byDifficultyData.length * 36)} />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pages: Review                                                       */
/* ------------------------------------------------------------------ */

function ReviewTopicCard({ stat, errors, open, onToggle, onBulkStatus, onSetStatus }) {
  const t = useTheme();
  const topicErrors = useMemo(
    () => errors.filter((e) => e.topic === stat.topic && e.domain === stat.domain && e.section === stat.section),
    [errors, stat],
  );
  return (
    <div className={`rounded-xl border ${t.card}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${t.textFaint}`} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={stat.section === SECTION_MATH ? 'indigo' : 'sky'}>{stat.section}</Badge>
              <Badge tone="neutral">{stat.domain}</Badge>
            </div>
            <h4 className="mt-1.5 truncate text-base font-semibold" style={SERIF}>{stat.topic}</h4>
          </div>
        </button>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex gap-4 text-sm">
            <span className={t.textMuted}>{stat.total} logged</span>
            <span className="text-rose-600">{stat.unreviewed} new</span>
            <span className="text-amber-600">{stat.reviewing} reviewing</span>
          </div>
          {stat.unreviewed > 0 && (
            <Button size="sm" variant="secondary" onClick={() => onBulkStatus(stat.topic, stat.domain, stat.section, 'Unreviewed', 'Reviewing')}>
              Start reviewing
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div className={`space-y-4 border-t px-5 py-4 ${t.border}`}>
          {topicErrors.map((e) => (
            <div key={e.id} className={`rounded-lg border p-4 ${t.border}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                <span className={`text-xs ${t.textFaint}`}>{fmtDate(e.date)}</span>
              </div>
              <p className="mt-2 text-sm">{e.description}</p>
              {e.explanation && <p className={`mt-2 text-sm ${t.textMuted}`}>{e.explanation}</p>}
              <div className="mt-3">
                <select value={e.status} onChange={(ev) => onSetStatus(e.id, ev.target.value)} className={`${inputCls(t)} w-auto`}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Review({ errors, onBulkStatus, onSetStatus }) {
  const t = useTheme();
  const [openTopic, setOpenTopic] = useState(null);
  const allStats = useMemo(() => topicStats(errors), [errors]);
  const needsReview = useMemo(() => allStats.filter((s) => s.unreviewed + s.reviewing > 0).sort((a, b) => b.score - a.score), [allStats]);
  const mastered = useMemo(() => allStats.filter((s) => s.unreviewed + s.reviewing === 0 && s.mastered > 0), [allStats]);
  const n = needsReview.length;
  const withPriority = needsReview.map((s, i) => ({
    ...s,
    priority: i < Math.ceil(n / 3) ? 'HIGH' : i < Math.ceil((2 * n) / 3) ? 'MEDIUM' : 'LOW',
  }));
  const groups = {
    HIGH: withPriority.filter((s) => s.priority === 'HIGH'),
    MEDIUM: withPriority.filter((s) => s.priority === 'MEDIUM'),
    LOW: withPriority.filter((s) => s.priority === 'LOW'),
  };
  const priorityLabels = { HIGH: 'High priority', MEDIUM: 'Medium priority', LOW: 'Low priority' };
  const priorityTones = { HIGH: 'rose', MEDIUM: 'amber', LOW: 'sky' };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl" style={SERIF}>Review</h1>
        <p className={`mt-1 text-sm ${t.textMuted}`}>Topics prioritized by how many mistakes still need work.</p>
      </div>

      {errors.length === 0 ? (
        <EmptyState icon={Repeat} title="Nothing to review yet" description="Log some mistakes in the Error Log and this page will build you a prioritized study list." />
      ) : n === 0 ? (
        <div className={`rounded-xl border p-8 text-center ${t.card}`}>
          <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-600" />
          <h3 className="text-lg font-semibold" style={SERIF}>Everything is reviewed</h3>
          <p className={`mt-2 text-sm ${t.textMuted}`}>Keep logging new mistakes as you take more practice tests to keep building this list.</p>
        </div>
      ) : (
        ['HIGH', 'MEDIUM', 'LOW'].map((pr) => groups[pr].length > 0 && (
          <div key={pr}>
            <div className="mb-3 flex items-center gap-2">
              <Badge tone={priorityTones[pr]}>{priorityLabels[pr]}</Badge>
              <span className={`text-sm ${t.textMuted}`}>{groups[pr].length} topic{groups[pr].length === 1 ? '' : 's'}</span>
            </div>
            <div className="space-y-3">
              {groups[pr].map((s) => {
                const key = s.topic + s.domain + s.section;
                return (
                  <ReviewTopicCard
                    key={key}
                    stat={s}
                    errors={errors}
                    open={openTopic === key}
                    onToggle={() => setOpenTopic((o) => (o === key ? null : key))}
                    onBulkStatus={onBulkStatus}
                    onSetStatus={onSetStatus}
                  />
                );
              })}
            </div>
          </div>
        ))
      )}

      {mastered.length > 0 && (
        <div className={`rounded-xl border p-5 ${t.card}`}>
          <h3 className="mb-3 text-sm font-semibold">No longer need review</h3>
          <div className="flex flex-wrap gap-2">
            {mastered.map((s) => (
              <Badge key={s.topic + s.domain + s.section} tone="emerald">
                <CheckCircle2 className="h-3 w-3" />{s.topic}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pages: Goals                                                        */
/* ------------------------------------------------------------------ */

function GoalProgressCard({ label, current, target, colorClass }) {
  const t = useTheme();
  if (current == null) {
    return (
      <div className={`rounded-xl border p-5 ${t.card}`}>
        <div className={`text-sm font-medium ${t.textMuted}`}>{label}</div>
        <p className={`mt-3 text-sm ${t.textFaint}`}>Add a practice test to track progress.</p>
      </div>
    );
  }
  const remaining = target - current;
  return (
    <div className={`rounded-xl border p-5 ${t.card}`}>
      <div className="mb-3 flex items-baseline justify-between">
        <span className={`text-sm font-medium ${t.textMuted}`}>{label}</span>
        <span className={`text-xs font-medium ${remaining <= 0 ? 'text-emerald-600' : t.textMuted}`}>
          {remaining <= 0 ? 'Target reached' : `${remaining} to go`}
        </span>
      </div>
      <div className="mb-3 flex items-end gap-2">
        <span className="text-2xl font-semibold tabular-nums" style={MONO}>{current}</span>
        <span className={`text-sm ${t.textFaint}`}>/ {target}</span>
      </div>
      <ProgressBar value={current} max={target} colorClass={colorClass} />
    </div>
  );
}

function Goals({ tests, config, onSaveTargets }) {
  const t = useTheme();
  const sortedTests = useMemo(() => [...tests].sort((a, b) => (a.date < b.date ? -1 : 1)), [tests]);
  const latest = sortedTests[sortedTests.length - 1];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl" style={SERIF}>Goals</h1>
        <p className={`mt-1 text-sm ${t.textMuted}`}>Set your target scores and track how close you are.</p>
      </div>
      <Card title="Target scores">
        <TargetForm config={config} onSave={onSaveTargets} />
      </Card>
      <div className="grid gap-4 sm:grid-cols-3">
        <GoalProgressCard label="Total score" current={latest ? latest.totalScore : null} target={config.targetTotal} colorClass="bg-amber-500" />
        <GoalProgressCard label="Math" current={latest ? latest.mathScore : null} target={config.targetMath} colorClass="bg-indigo-500" />
        <GoalProgressCard label="Reading & Writing" current={latest ? latest.rwScore : null} target={config.targetRW} colorClass="bg-sky-500" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pages: Settings                                                     */
/* ------------------------------------------------------------------ */

function SettingsPage({ config, userEmail, onSignOut, onSaveName, onToggleTheme, onSaveTargets, onExport, onImportClick, onLoadDemo, onDeleteAll }) {
  const t = useTheme();
  const [name, setName] = useState(config.userName);
  useEffect(() => setName(config.userName), [config.userName]);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl" style={SERIF}>Settings</h1>
        <p className={`mt-1 text-sm ${t.textMuted}`}>Your profile, appearance, and data.</p>
      </div>

      <Card title="Account" subtitle="Signed in with Supabase.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">{userEmail}</p>
          <Button variant="secondary" onClick={onSignOut}><LogOut className="h-4 w-4" />Sign out</Button>
        </div>
      </Card>

      <Card title="Profile">
        <form onSubmit={(e) => { e.preventDefault(); onSaveName(name.trim()); }} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <Field label="Your name">
              <input className={inputCls(t)} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jordan" />
            </Field>
          </div>
          <Button type="submit">Save name</Button>
        </form>
      </Card>

      <Card title="Appearance">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{config.theme === 'dark' ? 'Dark mode' : 'Light mode'}</p>
            <p className={`text-sm ${t.textMuted}`}>Switch how Scorebook looks. Syncs across your devices.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={config.theme === 'dark'}
            onClick={onToggleTheme}
            aria-label="Toggle dark mode"
            className={`relative h-7 w-12 rounded-full transition-colors ${config.theme === 'dark' ? 'bg-amber-600' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform ${config.theme === 'dark' ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </Card>

      <Card title="Target scores" subtitle="Used across your dashboard and goals.">
        <TargetForm config={config} onSave={onSaveTargets} />
      </Card>

      <Card title="Your data">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={onExport}><Download className="h-4 w-4" />Export as JSON</Button>
          <Button variant="secondary" onClick={onImportClick}><Upload className="h-4 w-4" />Import from JSON</Button>
          <Button variant="secondary" onClick={onLoadDemo}><Sparkles className="h-4 w-4" />Load demo data</Button>
        </div>
      </Card>

      <Card title="Danger zone" tone="danger">
        <p className={`mb-4 text-sm ${t.textMuted}`}>Permanently delete every practice test, error, and setting stored in your account.</p>
        <Button variant="danger" onClick={onDeleteAll}><Trash2 className="h-4 w-4" />Delete all data</Button>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Navigation shell                                                    */
/* ------------------------------------------------------------------ */

function Sidebar({ page, setPage, streak, navItems }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto bg-slate-900 md:flex">
      <div className="px-6 py-7">
        <div className="text-xl font-semibold text-white" style={SERIF}>Scorebook</div>
        <div className="mt-1 text-xs text-slate-400">Digital SAT tracker</div>
        <div className="mt-4">
          <StreakBadge streak={streak} size="sm" forceDark />
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
        {navItems.map((item) => {
          const active = page === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setPage(item.id)}
              className={`flex w-full items-center gap-3 rounded-r-lg border-l-2 px-3 py-2.5 text-sm transition-colors ${active ? 'border-amber-500 bg-slate-800 font-medium text-white' : 'border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="border-t border-slate-800 px-6 py-5 text-xs text-slate-500">Synced to your account</div>
    </aside>
  );
}

function MobileTopBar({ page, setPage, open, setOpen, streak, navItems }) {
  const t = useTheme();
  return (
    <div className={`sticky top-0 z-30 border-b md:hidden ${t.card}`}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="text-lg font-semibold" style={SERIF}>Scorebook</span>
        <div className="flex items-center gap-2">
          <StreakBadge streak={streak} size="sm" />
          <button type="button" onClick={() => setOpen((o) => !o)} className={`rounded-lg p-2 ${t.hoverSubtle}`} aria-label="Toggle navigation">
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>
      {open && (
        <div className={`border-t p-2 ${t.border}`}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = page === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => { setPage(item.id); setOpen(false); }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${active ? (t.dark ? 'bg-amber-500/10 font-medium text-amber-400' : 'bg-amber-50 font-medium text-amber-800') : `${t.text} ${t.hoverSubtle}`}`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="flex items-center gap-3 text-slate-500">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
        <span className="text-sm">Loading your data...</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  App                                                                 */
/* ------------------------------------------------------------------ */

export default function App() {
  const { user, signOut } = useAuth();
  // Cosmetic gate only: hides/shows the nav tab and page. The real boundary
  // is server-side (RLS + SECURITY DEFINER functions checking auth.uid(),
  // and api/admin/*.js checking process.env.ADMIN_USER_ID) - see
  // supabase/migrations/0006_admin_panel.sql. Nothing sent from this flag
  // is trusted by the server.
  const isAdmin = Boolean(user?.id && import.meta.env.VITE_ADMIN_USER_ID && user.id === import.meta.env.VITE_ADMIN_USER_ID);
  const navItems = isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;
  const [loading, setLoading] = useState(true);
  const [tests, setTests] = useState([]);
  const [errors, setErrors] = useState([]);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [streak, setStreak] = useState({ currentStreak: 0, longestStreak: 0, lastActiveDate: null });
  const [page, setPage] = useState('dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [dbError, setDbError] = useState(null);
  const fileInputRef = useRef(null);

  const loadData = useCallback(async () => {
    setDbError(null);
    try {
      const [safeTests, safeErrors, cfg, streakData] = await Promise.all([
        db.fetchTests(user.id),
        db.fetchErrors(user.id),
        db.fetchConfig(user.id),
        db.fetchStreak(user.id),
      ]);
      setTests(safeTests);
      setErrors(safeErrors);
      setConfig(cfg);
      setStreak(streakData);
    } catch (err) {
      console.error('Failed to load data from Supabase', err);
      setDbError('Could not load your data. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => { loadData(); }, [loadData]);

  function pushToast(message, type) {
    const id = genId('toast');
    setToasts((prev) => [...prev, { id, message, type: type || 'success' }]);
    setTimeout(() => setToasts((prev) => prev.filter((tt) => tt.id !== id)), 3200);
  }
  function askConfirm(opts) { setConfirmState(opts); }

  /**
   * Tells the server "the user did something meaningful today" (see
   * record_activity() in 0004_streaks.sql for the qualifying-activity
   * definition and the actual increment/reset rules, which live in SQL, not
   * here). Fire-and-forget by design, same as the AI-analysis refresh below
   * - a failed streak update shouldn't block or error out whatever the user
   * was actually trying to do.
   */
  function recordActivity() {
    db.bumpStreak(todayIso()).then(setStreak).catch((err) => console.error('Could not update streak', err));
  }

  async function addTest(data) {
    try {
      const rec = await db.insertTest(user.id, data);
      setTests((prev) => [...prev, rec]);
      pushToast('Practice test added.');
      recordActivity();
      // Fire-and-forget: refreshes the cached AI analysis in the background so
      // it's ready (post-test review) by the time the student opens the AI
      // Analysis page, without blocking or slowing down this form submit.
      fetchPerformanceAnalysis(true).catch(() => { /* surfaced on the AI Analysis page itself, not here */ });
    } catch (err) {
      console.error(err);
      pushToast('Could not save the test. Check your connection and try again.', 'error');
    }
  }
  async function editTest(id, data) {
    try {
      const rec = await db.updateTestRow(id, data);
      setTests((prev) => prev.map((tst) => (tst.id === id ? rec : tst)));
      pushToast('Practice test updated.');
      recordActivity();
    } catch (err) {
      console.error(err);
      pushToast('Could not update the test. Check your connection and try again.', 'error');
    }
  }
  function deleteTest(id) {
    askConfirm({
      title: 'Delete practice test?',
      message: "This will also unlink this test from any error-log entries that reference it. This can't be undone.",
      danger: true,
      confirmLabel: 'Delete test',
      onConfirm: async () => {
        try {
          await db.deleteTestRow(id);
          setTests((prev) => prev.filter((tst) => tst.id !== id));
          setErrors((prev) => prev.map((e) => (e.testId === id ? { ...e, testId: null } : e)));
          pushToast('Practice test deleted.');
        } catch (err) {
          console.error(err);
          pushToast('Could not delete the test. Check your connection and try again.', 'error');
        }
      },
    });
  }

  async function addError(data) {
    try {
      const rec = await db.insertErrorRow(user.id, data);
      setErrors((prev) => [...prev, rec]);
      pushToast('Mistake logged.');
      recordActivity();
    } catch (err) {
      console.error(err);
      pushToast('Could not save the error. Check your connection and try again.', 'error');
    }
  }
  async function editError(id, data) {
    const current = errors.find((e) => e.id === id);
    if (!current) return;
    try {
      const rec = await db.updateErrorRow(id, { ...current, ...data });
      setErrors((prev) => prev.map((e) => (e.id === id ? rec : e)));
      pushToast('Error updated.');
      // "Mark an error reviewed" qualifies as streak activity - defined as
      // the status actually changing away from Unreviewed into Reviewing or
      // Mastered. Editing other fields, or changing status back to
      // Unreviewed, doesn't count.
      if (data.status && data.status !== current.status && data.status !== 'Unreviewed') {
        recordActivity();
      }
    } catch (err) {
      console.error(err);
      pushToast('Could not update the error. Check your connection and try again.', 'error');
    }
  }
  function deleteError(id) {
    askConfirm({
      title: 'Delete this error?',
      message: "This can't be undone.",
      danger: true,
      confirmLabel: 'Delete error',
      onConfirm: async () => {
        try {
          await db.deleteErrorRow(id);
          setErrors((prev) => prev.filter((e) => e.id !== id));
          pushToast('Error deleted.');
        } catch (err) {
          console.error(err);
          pushToast('Could not delete the error. Check your connection and try again.', 'error');
        }
      },
    });
  }
  function setErrorStatus(id, status) {
    // Reuses editError instead of duplicating the update logic, so status
    // changes made from any part of the app behave identically.
    editError(id, { status });
  }
  async function bulkSetStatusForTopic(topic, domain, section, fromStatus, toStatus) {
    try {
      const updated = await db.bulkUpdateErrorStatus(user.id, { topic, domain, section, fromStatus, toStatus });
      const updatedIds = new Set(updated.map((e) => e.id));
      setErrors((prev) => prev.map((e) => (updatedIds.has(e.id) ? { ...e, status: toStatus } : e)));
      pushToast(`Marked ${topic} errors as ${toStatus}.`);
      if (updated.length > 0 && (toStatus === 'Reviewing' || toStatus === 'Mastered')) {
        recordActivity();
      }
    } catch (err) {
      console.error(err);
      pushToast('Could not update those errors. Check your connection and try again.', 'error');
    }
  }

  async function saveTargets(vals) {
    try {
      await db.updateGoals(user.id, vals);
      setConfig((prev) => ({ ...prev, ...vals }));
      pushToast('Goals updated.');
    } catch (err) {
      console.error(err);
      pushToast('Could not save your goals. Check your connection and try again.', 'error');
    }
  }
  async function saveName(nm) {
    try {
      await db.updateProfile(user.id, nm);
      setConfig((prev) => ({ ...prev, userName: nm }));
      pushToast('Name saved.');
    } catch (err) {
      console.error(err);
      pushToast('Could not save your name. Check your connection and try again.', 'error');
    }
  }
  async function toggleTheme() {
    const next = config.theme === 'dark' ? 'light' : 'dark';
    setConfig((prev) => ({ ...prev, theme: next }));
    try {
      await db.updateSettings(user.id, next);
    } catch (err) {
      console.error(err);
      pushToast('Theme changed locally, but could not be saved to your account.', 'error');
    }
  }

  function loadDemo() {
    const demo = buildDemoData();
    const proceed = async () => {
      try {
        const { tests: insertedTests, errors: insertedErrors } = await db.bulkImportTestsAndErrors(
          user.id, demo.tests, demo.errors, { replace: true },
        );
        const nm = config.userName || 'Alex';
        await db.updateProfile(user.id, nm);
        setTests(insertedTests);
        setErrors(insertedErrors);
        setConfig((prev) => ({ ...prev, userName: nm }));
        pushToast('Demo data loaded.');
      } catch (err) {
        console.error(err);
        pushToast('Could not load demo data. Check your connection and try again.', 'error');
      }
    };
    if (tests.length > 0 || errors.length > 0) {
      askConfirm({
        title: 'Replace with demo data?',
        message: "This will overwrite your current practice tests and error log with sample data. This can't be undone.",
        danger: true,
        confirmLabel: 'Load demo data',
        onConfirm: proceed,
      });
    } else {
      proceed();
    }
  }
  function deleteAllData() {
    askConfirm({
      title: 'Delete all data?',
      message: "This permanently deletes every practice test, logged error, and your saved goals. This can't be undone.",
      danger: true,
      confirmLabel: 'Delete everything',
      onConfirm: async () => {
        try {
          await db.deleteAllUserData(user.id);
          setTests([]);
          setErrors([]);
          setConfig({ ...DEFAULT_CONFIG });
          pushToast('All data deleted.');
        } catch (err) {
          console.error(err);
          pushToast('Could not delete your data. Check your connection and try again.', 'error');
        }
      },
    });
  }

  function handleExport() {
    const payload = { exportedAt: new Date().toISOString(), tests, errors, config };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sat-tracker-export-${todayIso()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    pushToast('Data exported.');
  }
  function handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(String(reader.result));
        const newTests = sanitizeTests(data.tests);
        const newErrors = sanitizeErrors(data.errors, new Set(newTests.map((t) => t.id)));
        const newConfig = data.config ? sanitizeConfig(data.config) : null;
        const { tests: insertedTests, errors: insertedErrors } = await db.bulkImportTestsAndErrors(
          user.id, newTests, newErrors, { replace: true },
        );
        setTests(insertedTests);
        setErrors(insertedErrors);
        if (newConfig) {
          await Promise.all([
            db.updateProfile(user.id, newConfig.userName),
            db.updateSettings(user.id, newConfig.theme),
            db.updateGoals(user.id, { targetTotal: newConfig.targetTotal, targetMath: newConfig.targetMath, targetRW: newConfig.targetRW }),
          ]);
          setConfig(newConfig);
        }
        pushToast('Data imported successfully.');
      } catch (err) {
        console.error(err);
        pushToast('Import failed. Check the file and your connection, then try again.', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  const dark = config.theme === 'dark';
  const tokens = useMemo(() => (dark ? darkTokens : lightTokens), [dark]);

  if (loading) return <LoadingScreen />;

  return (
    <ThemeCtx.Provider value={tokens}>
      <div className={`min-h-screen ${tokens.pageBg} ${tokens.text}`} style={{ fontFamily: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif" }}>
        <GlobalStyles />
        <div className="flex min-h-screen">
          <Sidebar page={page} setPage={setPage} streak={streak} navItems={navItems} />
          <div className="flex min-w-0 flex-1 flex-col">
            <MobileTopBar page={page} setPage={setPage} open={mobileNavOpen} setOpen={setMobileNavOpen} streak={streak} navItems={navItems} />
            <main key={page} className="sb-fade-in mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 md:px-10 md:py-10">
              {dbError && (
                <div className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${tokens.dark ? 'border-rose-900/50 bg-rose-950/30' : 'border-rose-200 bg-rose-50'}`}>
                  <p className="text-sm text-rose-600">{dbError}</p>
                  <Button size="sm" variant="secondary" onClick={loadData}>Retry</Button>
                </div>
              )}
              {page === 'dashboard' && <Dashboard tests={tests} errors={errors} config={config} streak={streak} onLoadDemo={loadDemo} goToTests={() => setPage('tests')} />}
              {page === 'tests' && <PracticeTests tests={tests} onAdd={addTest} onEdit={editTest} onDelete={deleteTest} />}
              {page === 'errors' && <ErrorLog errors={errors} tests={tests} onAdd={addError} onEdit={editError} onDelete={deleteError} />}
              {page === 'analytics' && <Analytics tests={tests} errors={errors} />}
              {page === 'ai-analysis' && <AIAnalysis tests={tests} errors={errors} goToTests={() => setPage('tests')} />}
              {page === 'review' && <Review errors={errors} onBulkStatus={bulkSetStatusForTopic} onSetStatus={setErrorStatus} />}
              {page === 'goals' && <Goals tests={tests} config={config} onSaveTargets={saveTargets} />}
              {page === 'settings' && (
                <SettingsPage
                  config={config}
                  userEmail={user.email}
                  onSignOut={signOut}
                  onSaveName={saveName}
                  onToggleTheme={toggleTheme}
                  onSaveTargets={saveTargets}
                  onExport={handleExport}
                  onImportClick={() => fileInputRef.current && fileInputRef.current.click()}
                  onLoadDemo={loadDemo}
                  onDeleteAll={deleteAllData}
                />
              )}
              {page === 'admin' && isAdmin && <AdminPanel />}
            </main>
          </div>
        </div>
        <ToastStack toasts={toasts} />
        <ConfirmDialog state={confirmState} onCancel={() => setConfirmState(null)} />
        <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleImportFile} />
      </div>
    </ThemeCtx.Provider>
  );
}
