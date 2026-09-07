import React, { createContext, useContext } from 'react';

/* ------------------------------------------------------------------ */
/*  Shared theme, layout primitives, and taxonomy constants.            */
/*                                                                       */
/*  Both SATTracker.jsx and admin/AdminPanel.jsx import FROM this file. */
/*  This file must never import from either of them - that would        */
/*  recreate the circular-import cycle (SATTracker -> AdminPanel ->     */
/*  SATTracker) that caused a production "Cannot access 'X' before      */
/*  initialization" crash: Vite/Rollup can bundle a real ES-module       */
/*  cycle in a way that trips the Temporal Dead Zone at runtime even     */
/*  when the source looks safe, so the fix is to not have a cycle at    */
/*  all rather than being careful about it.                             */
/* ------------------------------------------------------------------ */

export const SECTION_MATH = 'Math';
export const SECTION_RW = 'Reading & Writing';

export const DOMAINS = {
  [SECTION_MATH]: ['Algebra', 'Advanced Math', 'Problem-Solving and Data Analysis', 'Geometry and Trigonometry'],
  [SECTION_RW]: ['Information and Ideas', 'Craft and Structure', 'Expression of Ideas', 'Standard English Conventions'],
};

export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

export const SERIF = { fontFamily: "'Source Serif 4', Georgia, serif" };

// Uses local calendar date components (not toISOString, which is UTC-based
// and can land on the wrong day near midnight depending on the browser's
// time zone).
export function toLocalIso(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
export function todayIso() { return toLocalIso(new Date()); }

export const lightTokens = {
  dark: false,
  pageBg: 'bg-slate-50',
  card: 'bg-white border-slate-200',
  text: 'text-slate-900',
  textMuted: 'text-slate-600',
  textFaint: 'text-slate-500',
  border: 'border-slate-200',
  input: 'bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-amber-500',
  hoverSubtle: 'hover:bg-slate-100',
  chip: 'bg-slate-100 text-slate-700 border-slate-200',
};
export const darkTokens = {
  dark: true,
  pageBg: 'bg-slate-950',
  card: 'bg-slate-900 border-slate-800',
  text: 'text-slate-100',
  textMuted: 'text-slate-300',
  textFaint: 'text-slate-400',
  border: 'border-slate-800',
  input: 'bg-slate-800 border-slate-700 text-slate-100 placeholder-slate-500 focus:border-amber-500',
  hoverSubtle: 'hover:bg-slate-800',
  chip: 'bg-slate-800 text-slate-300 border-slate-700',
};

export const ThemeCtx = createContext(lightTokens);
export const useTheme = () => useContext(ThemeCtx);
export const inputCls = (t) => `w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors ${t.input}`;

export function Button({ variant = 'primary', size = 'md', className = '', children, ...props }) {
  const t = useTheme();
  const base = 'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-sm' };
  const variants = {
    primary: 'bg-amber-600 text-white hover:bg-amber-700',
    secondary: `border ${t.border} ${t.text} ${t.hoverSubtle}`,
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
    ghost: `${t.textMuted} ${t.hoverSubtle}`,
  };
  return <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props}>{children}</button>;
}

export function Card({ title, subtitle, children, tone = 'default', className = '' }) {
  const t = useTheme();
  const toneCls = tone === 'danger'
    ? (t.dark ? 'bg-slate-900 border-rose-900/50' : 'bg-white border-rose-200')
    : t.card;
  return (
    <div className={`rounded-xl border p-5 sm:p-6 ${toneCls} ${className}`}>
      {title && (
        <div className="mb-4">
          <h3 className="text-base font-semibold" style={SERIF}>{title}</h3>
          {subtitle && <p className={`mt-1 text-sm ${t.textMuted}`}>{subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Field({ label, children, hint }) {
  const t = useTheme();
  return (
    <label className="block">
      <span className={`mb-1.5 block text-sm font-medium ${t.text}`}>{label}</span>
      {children}
      {hint && <span className={`mt-1 block text-xs ${t.textMuted}`}>{hint}</span>}
    </label>
  );
}
