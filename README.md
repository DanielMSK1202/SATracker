# Scorebook — Digital SAT Tracker (V2 + AI Analysis)

A cloud-synced web app for tracking Digital SAT prep: practice tests, a
mistake log, analytics, a prioritized review queue, goals, settings, and an
AI-powered performance analysis engine. V2 added **Supabase-backed
authentication, cloud storage, and multi-user support**. This update adds
**AI Performance Analysis** — a background analytics/feedback engine (not a
chatbot) that interprets the student's real, deterministically-computed
statistics and turns them into personalized, evidence-based feedback.

## What's new in V2

- Email/password sign up, log in, log out, and persistent sessions (Supabase Auth)
- All app data (practice tests, errors, goals, settings, profile) now lives in
  Supabase Postgres instead of `localStorage`, scoped per user with RLS
- A one-time prompt to import any pre-V2 local data into your new account
- Loading, empty, network-error, and expired-session states throughout

V1.1's local-storage mode still exists in the codebase (`src/utils/storage.js`)
and is used only by the migration prompt to read legacy data — the running
app now always reads and writes through Supabase.

## What's new in AI Performance Analysis

- A new **AI Analysis** page: overall performance, section performance, AI
  summary, ranked strengths/weaknesses, recurring mistake patterns, an
  improvement tracker (vs. your previous analysis), ranked study priorities,
  and test strategy tips.
- An **Analyze Mistake** button on any logged error in the Error Log, giving
  a focused AI explanation of that specific mistake.
- Every statistic (scores, trends, category weakness ranking, mistake-reason
  frequency, improvement deltas) is computed **deterministically on the
  server**, before Groq ever sees the data — Groq only interprets and
  narrates numbers it's given, it never calculates them.
- This is explicitly **not a chatbot**: no chat history, no free-text
  question box, no "Ask AI." The analysis is generated automatically from
  the student's real data.
- Results are cached in Postgres (one row per user, one per logged mistake)
  and only regenerated when the underlying data actually changes, after a
  new test, or on a manual "Refresh analysis" — not on every page view.

## Project structure

```
sat-tracker/
├── index.html                    Vite entry HTML (mounts #root)
├── package.json                  Scripts and dependencies
├── vite.config.js                Vite + React plugin config
├── tailwind.config.js            Tailwind content paths
├── postcss.config.js             PostCSS pipeline (Tailwind + Autoprefixer)
├── .env.example                  Required environment variables (copy to .env.local)
├── supabase/
│   ├── migrations/
│   │   ├── 0001_init.sql          Tables, RLS policies, signup trigger
│   │   └── 0002_ai_analysis.sql    AI analysis cache tables + RLS
│   └── functions/
│       ├── _shared/                Code shared by both edge functions
│       │   ├── cors.ts              CORS headers + JSON response helper
│       │   ├── supabaseClient.ts    User-scoped Supabase client + auth check
│       │   ├── taxonomy.ts          Domain/topic/reason constants (mirrors SATTracker.jsx)
│       │   ├── analytics.ts         LAYER 1: deterministic stats, weakness scoring, improvement deltas
│       │   ├── groq.ts              Server-only Groq API call
│       │   ├── prompts.ts           System prompts (anti-chatbot, anti-fabrication rules)
│       │   └── validate.ts          Sanitizes/validates Groq's JSON output
│       ├── ai-analysis/index.ts      Global performance analysis endpoint
│       └── ai-mistake-analysis/index.ts  Single-mistake analysis endpoint
└── src/
    ├── main.jsx                   React entry point, renders <AppRoot />
    ├── AppRoot.jsx                Top-level gate: config check → auth → migration → app
    ├── SATTracker.jsx             The application (all pages, components, CRUD logic)
    ├── index.css                  Tailwind layers + base resets
    ├── auth/
    │   ├── AuthContext.jsx         Supabase Auth session state + sign up/in/out
    │   ├── AuthScreen.jsx          Sign up / log in screen
    │   └── MigrationPrompt.jsx     "Import existing local data?" one-time prompt
    ├── lib/
    │   ├── supabaseClient.js       Supabase client (reads env vars)
    │   ├── db.js                   All Supabase table queries; maps DB rows <-> app models
    │   └── ai.js                   Invokes the two AI edge functions
    └── utils/
        └── storage.js              localStorage adapter (used only for migration)
```

## Requirements


- Node.js 18+
- A free [Supabase](https://supabase.com) project

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run `supabase/migrations/0001_init.sql`, then
   `supabase/migrations/0002_ai_analysis.sql`, in that order. The first
   creates `profiles`, `settings`, `goals`, `practice_tests`, and `errors`
   with owner-only RLS and a signup trigger. The second adds `ai_analyses`
   and `ai_mistake_analyses`, the AI feature's result cache, also owner-only.
   Both are safe to re-run.
3. In **Project Settings → API**, copy the **Project URL** and the
   **anon public key**.
4. In **Authentication → Providers**, Email is enabled by default — that's
   all this app uses. (Optional: turn off "Confirm email" while developing so
   new accounts can log in immediately.)
5. **Deploy the AI edge functions** (requires the
   [Supabase CLI](https://supabase.com/docs/guides/cli)):
   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase secrets set GROQ_API_KEY=your-groq-api-key
   supabase functions deploy ai-analysis
   supabase functions deploy ai-mistake-analysis
   ```
   Get a Groq API key from [console.groq.com](https://console.groq.com). The
   key is stored as a Supabase secret and is only ever read inside the edge
   functions (`Deno.env.get('GROQ_API_KEY')`) — it is never bundled into the
   frontend, never sent to the browser, and not read from any `VITE_*`
   variable. `SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided to edge
   functions automatically by the platform; you don't set those yourself.

## Environment variables

Copy `.env.example` to `.env.local` and fill in the two values from step 3
above:

```
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

`.env.local` is already excluded via `.gitignore` — never commit real
credentials. Only the `anon` key is used client-side; it's safe to expose
(that's what RLS is for). Vite only exposes env vars prefixed `VITE_` to
the browser, and only these two are read (`src/lib/supabaseClient.js`).

## Run it

```bash
npm install
npm run dev
```

Open the URL Vite prints (defaults to `http://localhost:5173`). If the env
vars above aren't set, the app shows a setup screen instead of crashing.

## Build for production

```bash
npm run build
npm run preview
```

`npm run build` outputs static files to `dist/` — deployable to any static
host (Netlify, Vercel, GitHub Pages, S3, etc.). Set the two `VITE_SUPABASE_*`
env vars in your host's build settings the same way.

## Data & persistence

Every user's practice tests, errors, goals, settings, and display name are
stored in Supabase Postgres, scoped to their account by Row Level Security —
no user can read or write another user's rows. Data is available on any
device once signed in. **Settings → Export as JSON** still works for local
backups, and **Settings → Import from JSON** writes an imported file into
your Supabase account (replacing current tests/errors, same as demo data).

### Migrating from V1.1 (local-only)

The first time a user logs in, if this browser has data saved from the old
local-storage version, they're asked **"Import existing local SAT Tracker
data?"** with **Import** or **Skip** — nothing is imported or deleted
automatically, and the original local data is left untouched either way so
the choice is never destructive.

## Features

- **Auth** — sign up, log in, log out, persistent sessions, protected app
- **Dashboard** — current Total/Math/R&W scores, target gap, weakest topics,
  score progression chart, empty state with demo data
- **Practice Tests** — add, edit, delete; Total auto-calculates from Math + R&W
- **Error Log** — log mistakes with domain, topic, reason, correct explanation,
  difficulty, and status; filter and search; inline status updates
- **Analytics** — score/Math/R&W progression, errors by section/domain/topic/
  reason, mastery breakdown, ranked weakest topics
- **Review** — auto-prioritized HIGH/MEDIUM/LOW topics based on error counts
  and review status, with a bulk "start reviewing" action
- **Goals** — target scores with live progress bars
- **Settings** — account (email + sign out), name, light/dark mode, targets,
  JSON export/import, delete all data, load demo data
- **AI Analysis** — deterministic performance profile interpreted by Groq:
  AI summary, ranked strengths/weaknesses, recurring mistake patterns,
  improvement tracking vs. your last analysis, ranked study priorities, test
  strategy tips, plus a per-mistake "Analyze mistake" explanation in the
  Error Log. Not a chatbot — no chat history, no free-text question box.

## Known limitations

- Bulk operations (demo data, JSON import, and local-data migration) run as a
  sequence of Supabase calls, not a single database transaction. If your
  connection drops mid-operation, you could end up with a partial import;
  re-running the same action is safe (it inserts fresh rows or, for
  demo/import, clears and retries) but worth knowing about.
- Email confirmation, password reset, and social login are not implemented —
  only email/password sign up and log in, per the current scope.
- This app has no question bank or auto-graded question flow — mistakes are
  self-logged by the student (topic, description, reason, etc.), not tied to
  an exact question, answer choices, or an official answer key. The AI
  analysis and per-mistake explanations work from that self-logged data,
  not from a graded question record.
- There is no per-question or per-test timing data anywhere in this app, so
  the AI analysis intentionally never makes timing/pacing claims (per the
  spec's own instruction not to fabricate conclusions the data can't support).
- "Difficulty" is only recorded on logged mistakes, not on every question
  attempted, so the AI analysis reports the *distribution of difficulty
  among mistakes* (e.g. "most of your errors are on Medium questions"), not
  *accuracy by difficulty* (e.g. "68% on Hard questions") — the latter isn't
  knowable from this data model without inventing numbers.
- Weakness/recurring-pattern detection is capped by what's logged: a
  category with very few logged mistakes is deliberately classified as
  "isolated" or reported as low-confidence rather than a confirmed weakness.
- Groq's JSON output is validated and sanitized server-side (enums clamped,
  categories cross-checked against real data, arrays length-capped), which
  meaningfully reduces but can't mathematically guarantee zero risk from a
  malformed or adversarial model response — there is no code execution or
  tool-calling access granted to the model, which limits the practical impact.
