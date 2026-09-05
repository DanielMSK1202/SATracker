-- Rate-limits actual Groq calls per analysis target.
--
-- Run after 0002_ai_analysis.sql. Safe to re-run.
--
-- ai_analyses / ai_mistake_analyses only get a row once a Groq call *succeeds*.
-- That's not enough to stop quota abuse: if Groq is down (or the user just
-- keeps clicking "Refresh"/"Re-analyze"/"Try again"), there may be no
-- successful cache to fall back on yet, so nothing throttles the retries.
--
-- This table records the timestamp of the last *attempt* (success or
-- failure) per target, independent of whether that attempt produced a
-- cacheable result. The API routes check it before calling Groq at all.
create table if not exists public.ai_analysis_attempts (
  id text primary key, -- 'profile:<user_id>' or 'mistake:<error_id>'
  user_id uuid not null references auth.users (id) on delete cascade,
  last_attempted_at timestamptz not null default now()
);
create index if not exists ai_analysis_attempts_user_id_idx on public.ai_analysis_attempts (user_id);

alter table public.ai_analysis_attempts enable row level security;

drop policy if exists "ai_analysis_attempts_select_own" on public.ai_analysis_attempts;
drop policy if exists "ai_analysis_attempts_insert_own" on public.ai_analysis_attempts;
drop policy if exists "ai_analysis_attempts_update_own" on public.ai_analysis_attempts;
create policy "ai_analysis_attempts_select_own" on public.ai_analysis_attempts for select using (auth.uid() = user_id);
create policy "ai_analysis_attempts_insert_own" on public.ai_analysis_attempts for insert with check (auth.uid() = user_id);
create policy "ai_analysis_attempts_update_own" on public.ai_analysis_attempts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Written only by the ai-analysis / ai-mistake-analysis functions using the
-- caller's own JWT (no service-role bypass), same as the tables in 0002.
