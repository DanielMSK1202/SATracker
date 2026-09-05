-- Scorebook Daily Streak — schema additions
-- Run after 0003_ai_analysis_attempts.sql. Safe to re-run.
--
-- SCHEMA DECISION: a dedicated `user_streaks` table rather than columns on
-- `profiles`. `profiles` already has broad owner-write RLS (the client
-- upserts display_name directly), and the whole point of a streak is that
-- its numbers must never be settable by the client — only by trusted
-- server-side logic. Splitting it into its own table lets that table carry
-- a much stricter policy (read-only for the client; all writes go through
-- a SECURITY DEFINER function) without touching `profiles`' existing RLS.
--
-- QUALIFYING-ACTIVITY DEFINITION: a calendar day "counts" toward the streak
-- if the user does at least one of: add a practice test, edit a practice
-- test, log a new mistake, or change a mistake's status away from
-- 'Unreviewed' (i.e. mark it 'Reviewing' or 'Mastered'). Editing a mistake
-- without changing its status, deleting things, and viewing pages do not
-- count. This is enforced only by which client code paths call
-- `record_activity()` (see src/SATTracker.jsx) — see the note below on why
-- the numbers themselves are still safe even though the *trigger points*
-- are client-decided.

create table if not exists public.user_streaks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  last_active_date date,
  updated_at timestamptz not null default now()
);

alter table public.user_streaks enable row level security;

-- Read-only for the owning user. Deliberately no insert/update/delete
-- policies for the `authenticated` role: the only way to change a row is
-- through record_activity() below, which runs as the table owner (same
-- SECURITY DEFINER pattern as handle_new_user() in 0001_init.sql) and so
-- bypasses these policies from the inside while still enforcing
-- auth.uid()-scoping and the increment/reset rules in SQL, not in client
-- JS. A client can decide *when* to call record_activity (i.e. which
-- actions "count"), but cannot pass it an arbitrary streak value — only a
-- calendar date string, the same client-supplied-local-date pattern the
-- rest of this app already uses for practice_tests.date and errors.date.
drop policy if exists "user_streaks_select_own" on public.user_streaks;
create policy "user_streaks_select_own" on public.user_streaks for select using (auth.uid() = user_id);

-- ============================================================================
-- record_activity(p_local_date): the only way to mutate user_streaks.
--
-- p_local_date is the CALLER'S LOCAL calendar date (YYYY-MM-DD), not the
-- server's UTC date — this app has no stored timezone/locale setting, so
-- (like every other date in this schema) the client computes and sends its
-- own local date string. What the client cannot do is influence the
-- resulting current_streak/longest_streak numbers: those are fully
-- determined by this function's fixed rules, run with the definer's
-- privileges so no RLS policy needs to grant the client write access.
--
-- Rules (all evaluated in the database, not trusted from the client):
--   - no existing row                              -> current = longest = 1
--   - last_active_date = p_local_date               -> no change (idempotent
--                                                       for repeated activity
--                                                       on the same day)
--   - last_active_date = p_local_date - 1 day        -> current += 1
--   - last_active_date older than that (or missing)  -> current reset to 1
--   - p_local_date < last_active_date (clock skew /
--     stale client date)                             -> no-op, returns the
--                                                       row unchanged
--   - longest_streak is updated whenever current_streak exceeds it
-- ============================================================================
create or replace function public.record_activity(p_local_date date)
returns table (current_streak integer, longest_streak integer, last_active_date date)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.user_streaks%rowtype;
  v_new_current integer;
begin
  if v_user_id is null then
    raise exception 'record_activity() requires an authenticated user';
  end if;
  if p_local_date is null then
    raise exception 'p_local_date is required';
  end if;

  select * into v_existing from public.user_streaks where user_id = v_user_id for update;

  if not found then
    insert into public.user_streaks (user_id, current_streak, longest_streak, last_active_date, updated_at)
    values (v_user_id, 1, 1, p_local_date, now())
    returning public.user_streaks.current_streak, public.user_streaks.longest_streak, public.user_streaks.last_active_date
    into current_streak, longest_streak, last_active_date;
    return next;
    return;
  end if;

  -- Stale/backdated client date: don't move the streak backwards.
  if p_local_date < v_existing.last_active_date then
    current_streak := v_existing.current_streak;
    longest_streak := v_existing.longest_streak;
    last_active_date := v_existing.last_active_date;
    return next;
    return;
  end if;

  if p_local_date = v_existing.last_active_date then
    v_new_current := v_existing.current_streak;
  elsif p_local_date = v_existing.last_active_date + 1 then
    v_new_current := v_existing.current_streak + 1;
  else
    v_new_current := 1;
  end if;

  update public.user_streaks
  set current_streak = v_new_current,
      longest_streak = greatest(v_existing.longest_streak, v_new_current),
      last_active_date = p_local_date,
      updated_at = now()
  where user_id = v_user_id
  returning public.user_streaks.current_streak, public.user_streaks.longest_streak, public.user_streaks.last_active_date
  into current_streak, longest_streak, last_active_date;
  return next;
end;
$$;

-- Default Postgres behavior grants EXECUTE on new functions to PUBLIC
-- (including the anonymous role) — lock that down explicitly, matching the
-- rest of this app's "no anonymous access" posture, and only allow signed-in
-- users to call it.
revoke all on function public.record_activity(date) from public;
grant execute on function public.record_activity(date) to authenticated;
