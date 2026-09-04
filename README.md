# Scorebook — Digital SAT Tracker (V2)

A cloud-synced web app for tracking Digital SAT prep: practice tests, a
mistake log, analytics, a prioritized review queue, goals, and settings.
V2 adds **Supabase-backed authentication, cloud storage, and multi-user
support** — each signed-in user has their own private data, synced across
devices, enforced server-side with Row Level Security.

## What's new in V2

- Email/password sign up, log in, log out, and persistent sessions (Supabase Auth)
- All app data (practice tests, errors, goals, settings, profile) now lives in
  Supabase Postgres instead of `localStorage`, scoped per user with RLS
- A one-time prompt to import any pre-V2 local data into your new account
- Loading, empty, network-error, and expired-session states throughout

V1.1's local-storage mode still exists in the codebase (`src/utils/storage.js`)
and is used only by the migration prompt to read legacy data — the running
app now always reads and writes through Supabase.

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
│   └── migrations/
│       └── 0001_init.sql          Tables, RLS policies, signup trigger
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
    │   └── db.js                   All Supabase queries; maps DB rows <-> app models
    └── utils/
        └── storage.js              localStorage adapter (used only for migration)
```

## Requirements

- Node.js 18+
- A free [Supabase](https://supabase.com) project

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run the contents of `supabase/migrations/0001_init.sql`
   once. It creates `profiles`, `settings`, `goals`, `practice_tests`, and
   `errors`, enables Row Level Security with owner-only policies on all five,
   and adds a trigger that provisions a profile/settings/goals row for every
   new signup automatically. It's safe to re-run.
3. In **Project Settings → API**, copy the **Project URL** and the
   **anon public key**.
4. In **Authentication → Providers**, Email is enabled by default — that's
   all this app uses. (Optional: turn off "Confirm email" while developing so
   new accounts can log in immediately.)

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

## Known limitations

- Bulk operations (demo data, JSON import, and local-data migration) run as a
  sequence of Supabase calls, not a single database transaction. If your
  connection drops mid-operation, you could end up with a partial import;
  re-running the same action is safe (it inserts fresh rows or, for
  demo/import, clears and retries) but worth knowing about.
- Email confirmation, password reset, and social login are not implemented —
  only email/password sign up and log in, per the current scope.
