-- Scorebook Admin Panel — schema additions
-- Run after 0005_practice_questions.sql. Safe to re-run.
--
-- ============================================================================
-- ACTION REQUIRED BEFORE RUNNING THIS FILE:
-- Edit the UUID literal inside public._admin_uid() below to YOUR OWN
-- auth.users.id (Supabase Dashboard -> Authentication -> Users -> copy the
-- UID next to your account). That single function is the ONLY place in the
-- entire schema that names the admin account. Every admin-only function in
-- this file calls it (indirectly, via _require_admin()) instead of embedding
-- the UUID itself, so changing admins later is a one-line edit + re-run of
-- just this CREATE OR REPLACE statement — see the "changing the admin
-- account" note at the bottom of README.md.
-- ============================================================================
--
-- TRUST MODEL NOTE (same posture as 0005_practice_questions.sql):
-- No service-role key exists anywhere in this app. Admin authorization is
-- enforced independently in three places for defense in depth:
--   1. Postgres: every admin_* function below calls _require_admin(), which
--      raises an exception (never just returns 0 rows) if auth.uid() does
--      not match the hardcoded literal in _admin_uid().
--   2. The Vercel api/admin/*.js routes independently check the caller's id
--      (from their verified JWT) against process.env.ADMIN_USER_ID before
--      ever calling one of these functions.
--   3. The frontend hides the Admin nav tab unless the signed-in user's id
--      matches VITE_ADMIN_USER_ID — this is COSMETIC ONLY, never trusted as
--      a real boundary, since (1) and (2) enforce it independently of
--      anything the client claims about itself.
--
-- BLOCKING MODEL:
-- is_blocked is enforced at every layer a blocked user could otherwise reach
-- data or mutate it through, not just through api/ routes:
--   - A new _not_blocked() helper is added to the USING/WITH CHECK clause of
--     every owner-scoped RLS policy in this app (profiles, settings, goals,
--     practice_tests, errors, user_streaks, user_question_views,
--     practice_question_quota, generated_questions) EXCEPT
--     profiles_select_own, which is deliberately left unchanged so a blocked
--     user's own client can still read their own is_blocked flag and show
--     them a "you have been banned" screen instead of a wall of silent
--     failures.
--   - Every existing SECURITY DEFINER function from 0004/0005 is redefined
--     here with an added block check, because those functions run as the
--     table owner and BYPASS RLS internally — an RLS policy update alone
--     would not stop a blocked user from calling record_activity(),
--     claim_pool_question(), etc. directly.
--   - api/_lib/supabaseClient.js's getAuthenticatedUser() also checks
--     is_blocked so every existing api/ route rejects blocked users with a
--     403 before doing any work, as an extra layer on top of the two above
--     (belt-and-suspenders: RLS/functions are the real backstop; the api/
--     check just fails fast and cheaply).

-- ============================================================================
-- Admin identity: a single hardcoded UUID, defined in exactly one place.
-- ============================================================================
create or replace function public._admin_uid()
returns uuid
language sql
immutable
as $$
  select '00000000-0000-0000-0000-000000000000'::uuid; -- <-- REPLACE with your own auth.users.id
$$;

create or replace function public._require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if auth.uid() <> public._admin_uid() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
end;
$$;

-- Deliberately no GRANT EXECUTE to `authenticated` for either function above:
-- they are only ever called from inside other SECURITY DEFINER functions
-- owned by the same role, which always retains implicit execute privilege
-- on functions it owns. Nothing outside this file needs to call them
-- directly, so there is no reason to widen who can invoke them.
revoke all on function public._admin_uid() from public;
revoke all on function public._require_admin() from public;

-- ============================================================================
-- Blocking: is_blocked column + a shared read helper used by RLS policies
-- and by every SECURITY DEFINER function below.
-- ============================================================================
alter table public.profiles add column if not exists is_blocked boolean not null default false;

create or replace function public._not_blocked()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not coalesce((select is_blocked from public.profiles where id = auth.uid()), false);
$$;
revoke all on function public._not_blocked() from public;
grant execute on function public._not_blocked() to authenticated;

-- ============================================================================
-- RLS: add the block check to every owner-scoped policy except
-- profiles_select_own (a blocked user must still be able to read their own
-- profile row to see is_blocked and be shown the "banned" screen).
-- ============================================================================

-- profiles (select_own intentionally untouched, see note above)
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id and public._not_blocked());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id and public._not_blocked()) with check (auth.uid() = id and public._not_blocked());

-- settings
drop policy if exists "settings_select_own" on public.settings;
create policy "settings_select_own" on public.settings
  for select using (auth.uid() = user_id and public._not_blocked());
drop policy if exists "settings_insert_own" on public.settings;
create policy "settings_insert_own" on public.settings
  for insert with check (auth.uid() = user_id and public._not_blocked());
drop policy if exists "settings_update_own" on public.settings;
create policy "settings_update_own" on public.settings
  for update using (auth.uid() = user_id and public._not_blocked()) with check (auth.uid() = user_id and public._not_blocked());

-- goals
drop policy if exists "goals_select_own" on public.goals;
create policy "goals_select_own" on public.goals
  for select using (auth.uid() = user_id and public._not_blocked());
drop policy if exists "goals_insert_own" on public.goals;
create policy "goals_insert_own" on public.goals
  for insert with check (auth.uid() = user_id and public._not_blocked());
drop policy if exists "goals_update_own" on public.goals;
create policy "goals_update_own" on public.goals
  for update using (auth.uid() = user_id and public._not_blocked()) with check (auth.uid() = user_id and public._not_blocked());

-- practice_tests
drop policy if exists "practice_tests_select_own" on public.practice_tests;
create policy "practice_tests_select_own" on public.practice_tests
  for select using (auth.uid() = user_id and public._not_blocked());
drop policy if exists "practice_tests_insert_own" on public.practice_tests;
create policy "practice_tests_insert_own" on public.practice_tests
  for insert with check (auth.uid() = user_id and public._not_blocked());
drop policy if exists "practice_tests_update_own" on public.practice_tests;
create policy "practice_tests_update_own" on public.practice_tests
  for update using (auth.uid() = user_id and public._not_blocked()) with check (auth.uid() = user_id and public._not_blocked());
drop policy if exists "practice_tests_delete_own" on public.practice_tests;
create policy "practice_tests_delete_own" on public.practice_tests
  for delete using (auth.uid() = user_id and public._not_blocked());

-- errors
drop policy if exists "errors_select_own" on public.errors;
create policy "errors_select_own" on public.errors
  for select using (auth.uid() = user_id and public._not_blocked());
drop policy if exists "errors_insert_own" on public.errors;
create policy "errors_insert_own" on public.errors
  for insert with check (auth.uid() = user_id and public._not_blocked());
drop policy if exists "errors_update_own" on public.errors;
create policy "errors_update_own" on public.errors
  for update using (auth.uid() = user_id and public._not_blocked()) with check (auth.uid() = user_id and public._not_blocked());
drop policy if exists "errors_delete_own" on public.errors;
create policy "errors_delete_own" on public.errors
  for delete using (auth.uid() = user_id and public._not_blocked());

-- user_streaks (writes only ever happen through record_activity(), updated below)
drop policy if exists "user_streaks_select_own" on public.user_streaks;
create policy "user_streaks_select_own" on public.user_streaks
  for select using (auth.uid() = user_id and public._not_blocked());

-- generated_questions (shared pool — still gate reads on the reader being unblocked)
drop policy if exists "generated_questions_select_any_authenticated" on public.generated_questions;
create policy "generated_questions_select_any_authenticated" on public.generated_questions
  for select to authenticated using (public._not_blocked());

-- user_question_views
drop policy if exists "user_question_views_select_own" on public.user_question_views;
create policy "user_question_views_select_own" on public.user_question_views
  for select using (auth.uid() = user_id and public._not_blocked());

-- practice_question_quota
drop policy if exists "practice_question_quota_select_own" on public.practice_question_quota;
create policy "practice_question_quota_select_own" on public.practice_question_quota
  for select using (auth.uid() = user_id and public._not_blocked());

-- ============================================================================
-- Redefine existing SECURITY DEFINER functions (from 0004/0005) to add the
-- same block check. These bypass RLS internally by design, so the policy
-- updates above alone would not stop a blocked user from calling them.
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
  if not public._not_blocked() then
    raise exception 'Your account has been blocked.' using errcode = '28000';
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
  if not public._not_blocked() then
    raise exception 'Your account has been blocked.' using errcode = '28000';
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

create or replace function public.any_pool_question(
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
begin
  if v_user_id is null then
    raise exception 'any_pool_question() requires an authenticated user';
  end if;
  if not public._not_blocked() then
    raise exception 'Your account has been blocked.' using errcode = '28000';
  end if;

  return query
  select gq.id, gq.section, gq.domain, gq.topic, gq.difficulty, gq.question, gq.model, gq.created_at
  from public.generated_questions gq
  where gq.section = p_section and gq.domain = p_domain
    and gq.topic = p_topic and gq.difficulty = p_difficulty
  order by gq.created_at desc
  limit 1;
end;
$$;

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
  if not public._not_blocked() then
    raise exception 'Your account has been blocked.' using errcode = '28000';
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
  if not public._not_blocked() then
    raise exception 'Your account has been blocked.' using errcode = '28000';
  end if;

  insert into public.practice_question_quota (user_id, quota_date, generated_count, updated_at)
  values (v_user_id, p_date, 1, now())
  on conflict (user_id, quota_date) do update
    set generated_count = public.practice_question_quota.generated_count + 1,
        updated_at = now()
    where public.practice_question_quota.generated_count < p_max
  returning generated_count into v_new_count;

  return v_new_count;
end;
$$;

create or replace function public.practice_quota_status(p_date date)
returns integer
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'practice_quota_status() requires an authenticated user';
  end if;
  if not public._not_blocked() then
    raise exception 'Your account has been blocked.' using errcode = '28000';
  end if;

  select coalesce(generated_count, 0) into v_count
  from public.practice_question_quota
  where user_id = v_user_id and quota_date = p_date;

  return coalesce(v_count, 0);
end;
$$;

-- ============================================================================
-- admin_list_users(): every user's id, display_name, created_at, is_blocked,
-- plus practice-test count, logged-error count, current streak, and today's
-- (p_quota_date's) practice-question generation usage. p_quota_date follows
-- the same "client sends its own local calendar date" convention as every
-- other date in this schema (practice_tests.date, bump_practice_quota, etc.)
-- rather than trusting the server's UTC "today" — defaults to current_date
-- if the caller omits it.
-- ============================================================================
create or replace function public.admin_list_users(p_quota_date date default current_date)
returns table (
  id uuid,
  display_name text,
  created_at timestamptz,
  is_blocked boolean,
  practice_test_count integer,
  error_count integer,
  current_streak integer,
  quota_used integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();

  return query
  select
    p.id,
    p.display_name,
    p.created_at,
    p.is_blocked,
    coalesce(pt.cnt, 0)::integer as practice_test_count,
    coalesce(er.cnt, 0)::integer as error_count,
    coalesce(us.current_streak, 0)::integer as current_streak,
    coalesce(pq.generated_count, 0)::integer as quota_used
  from public.profiles p
  left join (select user_id, count(*) as cnt from public.practice_tests group by user_id) pt on pt.user_id = p.id
  left join (select user_id, count(*) as cnt from public.errors group by user_id) er on er.user_id = p.id
  left join public.user_streaks us on us.user_id = p.id
  left join public.practice_question_quota pq on pq.user_id = p.id and pq.quota_date = p_quota_date
  order by p.created_at asc;
end;
$$;

-- ============================================================================
-- admin_toggle_user_blocked(): flips is_blocked for a given user and returns
-- the new value. Refuses to ever block the admin account itself, so a
-- mis-click can't lock the admin out of their own panel.
-- ============================================================================
create or replace function public.admin_toggle_user_blocked(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_value boolean;
begin
  perform public._require_admin();

  if p_user_id = public._admin_uid() then
    raise exception 'The admin account cannot be blocked.';
  end if;

  update public.profiles
  set is_blocked = not is_blocked
  where id = p_user_id
  returning is_blocked into v_new_value;

  if not found then
    raise exception 'User not found.';
  end if;

  return v_new_value;
end;
$$;

-- ============================================================================
-- admin_list_questions(): the full shared generated_questions pool,
-- filterable by section/domain/topic/difficulty (pass null to skip a
-- filter), each row annotated with how many distinct users have viewed it.
-- Sorting is left to the frontend over this already-filtered result set
-- rather than a dynamic ORDER BY here.
-- ============================================================================
create or replace function public.admin_list_questions(
  p_section text default null,
  p_domain text default null,
  p_topic text default null,
  p_difficulty text default null
)
returns table (
  id uuid,
  section text,
  domain text,
  topic text,
  difficulty text,
  question jsonb,
  model text,
  created_at timestamptz,
  view_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();

  return query
  select
    gq.id, gq.section, gq.domain, gq.topic, gq.difficulty, gq.question, gq.model, gq.created_at,
    coalesce(uv.cnt, 0) as view_count
  from public.generated_questions gq
  left join (select question_id, count(*) as cnt from public.user_question_views group by question_id) uv
    on uv.question_id = gq.id
  where (p_section is null or gq.section = p_section)
    and (p_domain is null or gq.domain = p_domain)
    and (p_topic is null or gq.topic = p_topic)
    and (p_difficulty is null or gq.difficulty = p_difficulty)
  order by gq.created_at desc;
end;
$$;

-- ============================================================================
-- admin_delete_question(): removes a single row from generated_questions
-- (e.g. a bad/wrong AI question). user_question_views rows for it are
-- removed automatically via the existing ON DELETE CASCADE foreign key.
-- ============================================================================
create or replace function public.admin_delete_question(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();

  delete from public.generated_questions where id = p_question_id;

  if not found then
    raise exception 'Question not found.';
  end if;
end;
$$;

-- ============================================================================
-- Grants. Only `authenticated` may call any of these — the internal
-- _require_admin() check is what actually restricts callers to the one
-- admin uid, not the grant itself (same non-negotiable pattern as 0005).
-- ============================================================================
revoke all on function public.record_activity(date) from public;
revoke all on function public.claim_pool_question(text, text, text, text) from public;
revoke all on function public.any_pool_question(text, text, text, text) from public;
revoke all on function public.insert_generated_question(text, text, text, text, jsonb, text) from public;
revoke all on function public.bump_practice_quota(date, integer) from public;
revoke all on function public.practice_quota_status(date) from public;
revoke all on function public.admin_list_users(date) from public;
revoke all on function public.admin_toggle_user_blocked(uuid) from public;
revoke all on function public.admin_list_questions(text, text, text, text) from public;
revoke all on function public.admin_delete_question(uuid) from public;

grant execute on function public.record_activity(date) to authenticated;
grant execute on function public.claim_pool_question(text, text, text, text) to authenticated;
grant execute on function public.any_pool_question(text, text, text, text) to authenticated;
grant execute on function public.insert_generated_question(text, text, text, text, jsonb, text) to authenticated;
grant execute on function public.bump_practice_quota(date, integer) to authenticated;
grant execute on function public.practice_quota_status(date) to authenticated;
grant execute on function public.admin_list_users(date) to authenticated;
grant execute on function public.admin_toggle_user_blocked(uuid) to authenticated;
grant execute on function public.admin_list_questions(text, text, text, text) to authenticated;
grant execute on function public.admin_delete_question(uuid) to authenticated;
