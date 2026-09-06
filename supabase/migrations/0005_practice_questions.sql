-- Scorebook AI Practice Questions — schema additions
-- Run after 0004_streaks.sql. Safe to re-run.
--
-- Three tables:
--   generated_questions     — SHARED pool across every user, keyed by
--                              section/domain/topic/difficulty.
--   user_question_views     — which user has seen which pool question, so
--                              the same user isn't served a repeat.
--   practice_question_quota — per-user, per-calendar-day count of *new*
--                              Gemini generations (serving an existing pool
--                              question never touches this counter).
--
-- TRUST MODEL NOTE (please read before deploying):
-- This app has no service-role key anywhere — every request, including from
-- api/practice-question.js, runs as the calling user's own JWT through the
-- anon key. That's fine for tables scoped to auth.uid() = user_id (a user
-- can only ever mess up their own rows), but generated_questions is a
-- SHARED table, so "any authenticated client can write here" is a bigger
-- blast radius: a buggy or malicious client could insert garbage that gets
-- served to *other* students. To keep the "write: server only" intent real
-- without a service-role key, this migration takes the same approach
-- 0001_init.sql already uses for handle_new_user(): all writes to these
-- three tables happen ONLY through SECURITY DEFINER functions below. There
-- is deliberately no INSERT/UPDATE policy granted to the `authenticated`
-- role on any of the three tables — only SELECT policies plus these
-- functions, which run with the table owner's privileges (bypassing RLS
-- internally) while still enforcing auth.uid()-scoping and shape rules in
-- SQL. This is a real improvement over a plain "insert with check (true)"
-- policy, but please double-check it does what you expect for your Supabase
-- project's role setup before relying on it in production (see README note
-- suggested in the summary).

create table if not exists public.generated_questions (
  id uuid primary key default gen_random_uuid(),
  section text not null check (section in ('Math', 'Reading & Writing')),
  domain text not null,
  topic text not null,
  difficulty text not null check (difficulty in ('Easy', 'Medium', 'Hard')),
  -- { stem: string, choices: [{id, text}], correctChoiceId: string, explanation: string }
  -- Full shape/enum validation happens in api/_lib/validate.js before this
  -- table is ever written to; these checks are cheap defense-in-depth so a
  -- malformed row can't silently make it into the shared pool.
  question jsonb not null check (
    jsonb_typeof(question) = 'object'
    and question ? 'stem'
    and question ? 'choices'
    and question ? 'correctChoiceId'
    and question ? 'explanation'
  ),
  model text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists generated_questions_lookup_idx
  on public.generated_questions (section, domain, topic, difficulty);

create table if not exists public.user_question_views (
  user_id uuid not null references auth.users (id) on delete cascade,
  question_id uuid not null references public.generated_questions (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, question_id)
);
create index if not exists user_question_views_user_id_idx on public.user_question_views (user_id);

create table if not exists public.practice_question_quota (
  user_id uuid not null references auth.users (id) on delete cascade,
  quota_date date not null,
  generated_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, quota_date)
);

alter table public.generated_questions enable row level security;
alter table public.user_question_views enable row level security;
alter table public.practice_question_quota enable row level security;

-- generated_questions: every signed-in user may READ the whole shared pool
-- (that's the point of sharing it); nobody gets a direct write policy.
drop policy if exists "generated_questions_select_any_authenticated" on public.generated_questions;
create policy "generated_questions_select_any_authenticated" on public.generated_questions
  for select to authenticated using (true);

-- user_question_views: a user can only see their own view history. Writes
-- happen only inside the functions below.
drop policy if exists "user_question_views_select_own" on public.user_question_views;
create policy "user_question_views_select_own" on public.user_question_views
  for select using (auth.uid() = user_id);

-- practice_question_quota: a user can read their own quota row directly
-- (used to show "N of 10 left today"); incrementing happens only inside
-- bump_practice_quota() below, atomically.
drop policy if exists "practice_question_quota_select_own" on public.practice_question_quota;
create policy "practice_question_quota_select_own" on public.practice_question_quota
  for select using (auth.uid() = user_id);

-- ============================================================================
-- claim_pool_question(): atomically finds a pool question matching the
-- given category that the CALLING user hasn't seen yet, records it as seen,
-- and returns it. Returns zero rows if nothing matches — the caller (the
-- API route) then falls through to the quota/generation path.
-- ============================================================================
create or replace function public.claim_pool_question(
  p_section text, p_domain text, p_topic text, p_difficulty text
)
returns table (
  id uuid, section text, domain text, topic text, difficulty text,
  question jsonb, model text, created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.generated_questions%rowtype;
begin
  if v_user_id is null then
    raise exception 'claim_pool_question() requires an authenticated user';
  end if;

  select gq.* into v_row
  from public.generated_questions gq
  where gq.section = p_section
    and gq.domain = p_domain
    and gq.topic = p_topic
    and gq.difficulty = p_difficulty
    and not exists (
      select 1 from public.user_question_views uqv
      where uqv.user_id = v_user_id and uqv.question_id = gq.id
    )
  order by gq.created_at asc
  limit 1;

  if not found then
    return;
  end if;

  insert into public.user_question_views (user_id, question_id)
  values (v_user_id, v_row.id)
  on conflict (user_id, question_id) do nothing;

  id := v_row.id; section := v_row.section; domain := v_row.domain; topic := v_row.topic;
  difficulty := v_row.difficulty; question := v_row.question; model := v_row.model; created_at := v_row.created_at;
  return next;
end;
$$;

-- ============================================================================
-- any_pool_question(): fallback lookup used only when the daily quota is
-- exhausted and claim_pool_question() found nothing unseen — returns any
-- pool question for the category (seen or not), most recent first, so the
-- student still gets *something* to practice rather than a bare error. Does
-- not touch user_question_views (re-serving a seen question doesn't need a
-- new "seen" record) and never calls Gemini.
-- ============================================================================
create or replace function public.any_pool_question(
  p_section text, p_domain text, p_topic text, p_difficulty text
)
returns table (
  id uuid, section text, domain text, topic text, difficulty text,
  question jsonb, model text, created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select gq.id, gq.section, gq.domain, gq.topic, gq.difficulty, gq.question, gq.model, gq.created_at
  from public.generated_questions gq
  where gq.section = p_section and gq.domain = p_domain
    and gq.topic = p_topic and gq.difficulty = p_difficulty
  order by gq.created_at desc
  limit 1;
$$;

-- ============================================================================
-- insert_generated_question(): the only way a new row can ever be added to
-- generated_questions. Called by api/practice-question.js only after Gemini's
-- output has already passed validatePracticeQuestion() in application code;
-- the CHECK constraint on the `question` column is a second, cheaper layer
-- in case that ever changes. Also immediately marks the new question as
-- seen by the requesting user (they just generated it for themselves).
-- ============================================================================
create or replace function public.insert_generated_question(
  p_section text, p_domain text, p_topic text, p_difficulty text,
  p_question jsonb, p_model text
)
returns table (
  id uuid, section text, domain text, topic text, difficulty text,
  question jsonb, model text, created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.generated_questions%rowtype;
begin
  if v_user_id is null then
    raise exception 'insert_generated_question() requires an authenticated user';
  end if;

  insert into public.generated_questions (section, domain, topic, difficulty, question, model)
  values (p_section, p_domain, p_topic, p_difficulty, p_question, coalesce(p_model, ''))
  returning * into v_row;

  insert into public.user_question_views (user_id, question_id) values (v_user_id, v_row.id)
  on conflict (user_id, question_id) do nothing;

  id := v_row.id; section := v_row.section; domain := v_row.domain; topic := v_row.topic;
  difficulty := v_row.difficulty; question := v_row.question; model := v_row.model; created_at := v_row.created_at;
  return next;
end;
$$;

-- ============================================================================
-- bump_practice_quota(): atomically increments today's generation counter
-- for the calling user IF it is currently below p_max, and returns the new
-- count. Returns NULL (no rows) if the user is already at/over p_max, and
-- leaves the counter untouched in that case. The atomicity comes from
-- INSERT ... ON CONFLICT ... DO UPDATE ... WHERE: under concurrent calls,
-- Postgres serializes the conflicting upserts on the row's primary key, so
-- two simultaneous requests can't both read "9" and both write "10".
-- ============================================================================
create or replace function public.bump_practice_quota(p_date date, p_max integer default 10)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_new_count integer;
begin
  if v_user_id is null then
    raise exception 'bump_practice_quota() requires an authenticated user';
  end if;

  insert into public.practice_question_quota (user_id, quota_date, generated_count, updated_at)
  values (v_user_id, p_date, 1, now())
  on conflict (user_id, quota_date) do update
    set generated_count = public.practice_question_quota.generated_count + 1,
        updated_at = now()
    where public.practice_question_quota.generated_count < p_max
  returning generated_count into v_new_count;

  return v_new_count; -- NULL if the WHERE clause skipped the update (quota already hit)
end;
$$;

-- ============================================================================
-- practice_quota_status(): read-only helper returning today's used count
-- (0 if no row yet) so the API route doesn't need a separate raw SELECT with
-- its own date-formatting logic.
-- ============================================================================
create or replace function public.practice_quota_status(p_date date)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select generated_count from public.practice_question_quota
     where user_id = auth.uid() and quota_date = p_date),
    0
  );
$$;

revoke all on function public.claim_pool_question(text, text, text, text) from public;
revoke all on function public.any_pool_question(text, text, text, text) from public;
revoke all on function public.insert_generated_question(text, text, text, text, jsonb, text) from public;
revoke all on function public.bump_practice_quota(date, integer) from public;
revoke all on function public.practice_quota_status(date) from public;

grant execute on function public.claim_pool_question(text, text, text, text) to authenticated;
grant execute on function public.any_pool_question(text, text, text, text) to authenticated;
grant execute on function public.insert_generated_question(text, text, text, text, jsonb, text) to authenticated;
grant execute on function public.bump_practice_quota(date, integer) to authenticated;
grant execute on function public.practice_quota_status(date) to authenticated;
