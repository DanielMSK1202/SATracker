-- Scorebook V2 - Supabase schema
-- Run this once against your Supabase project (SQL Editor, or `supabase db push`
-- if using the Supabase CLI with this file under supabase/migrations/).
-- Safe to re-run: every statement is idempotent (if not exists / or replace).

-- ============================================================================
-- TABLES
-- ============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  theme text not null default 'light' check (theme in ('light', 'dark')),
  updated_at timestamptz not null default now()
);

create table if not exists public.goals (
  user_id uuid primary key references auth.users (id) on delete cascade,
  target_total integer not null default 1400 check (target_total between 400 and 1600),
  target_math integer not null default 700 check (target_math between 200 and 800),
  target_rw integer not null default 700 check (target_rw between 200 and 800),
  updated_at timestamptz not null default now()
);

create table if not exists public.practice_tests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'Practice Test',
  date date not null,
  math_score integer not null check (math_score between 200 and 800),
  rw_score integer not null check (rw_score between 200 and 800),
  total_score integer not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists practice_tests_user_id_idx on public.practice_tests (user_id);

create table if not exists public.errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  test_id uuid references public.practice_tests (id) on delete set null,
  date date not null,
  section text not null check (section in ('Math', 'Reading & Writing')),
  domain text not null,
  topic text not null,
  description text not null default '',
  reason text not null default '',
  explanation text not null default '',
  difficulty text not null default 'Medium' check (difficulty in ('Easy', 'Medium', 'Hard')),
  status text not null default 'Unreviewed' check (status in ('Unreviewed', 'Reviewing', 'Mastered')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists errors_user_id_idx on public.errors (user_id);
create index if not exists errors_test_id_idx on public.errors (test_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- Every table is scoped to auth.uid() so a user can only ever see, insert,
-- update, or delete their own rows. No table is readable/writable by anyone
-- who isn't the owning authenticated user.
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.goals enable row level security;
alter table public.practice_tests enable row level security;
alter table public.errors enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "settings_select_own" on public.settings;
drop policy if exists "settings_insert_own" on public.settings;
drop policy if exists "settings_update_own" on public.settings;
create policy "settings_select_own" on public.settings for select using (auth.uid() = user_id);
create policy "settings_insert_own" on public.settings for insert with check (auth.uid() = user_id);
create policy "settings_update_own" on public.settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "goals_select_own" on public.goals;
drop policy if exists "goals_insert_own" on public.goals;
drop policy if exists "goals_update_own" on public.goals;
create policy "goals_select_own" on public.goals for select using (auth.uid() = user_id);
create policy "goals_insert_own" on public.goals for insert with check (auth.uid() = user_id);
create policy "goals_update_own" on public.goals for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "practice_tests_select_own" on public.practice_tests;
drop policy if exists "practice_tests_insert_own" on public.practice_tests;
drop policy if exists "practice_tests_update_own" on public.practice_tests;
drop policy if exists "practice_tests_delete_own" on public.practice_tests;
create policy "practice_tests_select_own" on public.practice_tests for select using (auth.uid() = user_id);
create policy "practice_tests_insert_own" on public.practice_tests for insert with check (auth.uid() = user_id);
create policy "practice_tests_update_own" on public.practice_tests for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "practice_tests_delete_own" on public.practice_tests for delete using (auth.uid() = user_id);

drop policy if exists "errors_select_own" on public.errors;
drop policy if exists "errors_insert_own" on public.errors;
drop policy if exists "errors_update_own" on public.errors;
drop policy if exists "errors_delete_own" on public.errors;
create policy "errors_select_own" on public.errors for select using (auth.uid() = user_id);
create policy "errors_insert_own" on public.errors for insert with check (auth.uid() = user_id);
create policy "errors_update_own" on public.errors for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "errors_delete_own" on public.errors for delete using (auth.uid() = user_id);

-- ============================================================================
-- AUTO-PROVISION on signup: every new auth user gets a profile/settings/goals
-- row immediately, so the app never has to guess whether they exist yet.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name) values (new.id, '')
    on conflict (id) do nothing;
  insert into public.settings (user_id, theme) values (new.id, 'light')
    on conflict (user_id) do nothing;
  insert into public.goals (user_id, target_total, target_math, target_rw) values (new.id, 1400, 700, 700)
    on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================================
-- Keep updated_at fresh on every UPDATE.
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at_profiles on public.profiles;
create trigger set_updated_at_profiles before update on public.profiles for each row execute procedure public.set_updated_at();

drop trigger if exists set_updated_at_settings on public.settings;
create trigger set_updated_at_settings before update on public.settings for each row execute procedure public.set_updated_at();

drop trigger if exists set_updated_at_goals on public.goals;
create trigger set_updated_at_goals before update on public.goals for each row execute procedure public.set_updated_at();

drop trigger if exists set_updated_at_practice_tests on public.practice_tests;
create trigger set_updated_at_practice_tests before update on public.practice_tests for each row execute procedure public.set_updated_at();

drop trigger if exists set_updated_at_errors on public.errors;
create trigger set_updated_at_errors before update on public.errors for each row execute procedure public.set_updated_at();
