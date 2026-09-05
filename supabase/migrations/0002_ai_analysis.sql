-- Scorebook AI Performance Analysis - schema additions
-- Run after 0001_init.sql. Safe to re-run.

-- One cached "global" analysis per user (upserted on refresh).
create table if not exists public.ai_analyses (
  user_id uuid primary key references auth.users (id) on delete cascade,
  fingerprint text not null,
  profile jsonb not null,
  analysis jsonb not null,
  model text not null default '',
  created_at timestamptz not null default now()
);

-- One cached analysis per logged mistake (keyed by the error it explains).
create table if not exists public.ai_mistake_analyses (
  error_id uuid primary key references public.errors (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  analysis jsonb not null,
  model text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ai_mistake_analyses_user_id_idx on public.ai_mistake_analyses (user_id);

alter table public.ai_analyses enable row level security;
alter table public.ai_mistake_analyses enable row level security;

drop policy if exists "ai_analyses_select_own" on public.ai_analyses;
drop policy if exists "ai_analyses_insert_own" on public.ai_analyses;
drop policy if exists "ai_analyses_update_own" on public.ai_analyses;
drop policy if exists "ai_analyses_delete_own" on public.ai_analyses;
create policy "ai_analyses_select_own" on public.ai_analyses for select using (auth.uid() = user_id);
create policy "ai_analyses_insert_own" on public.ai_analyses for insert with check (auth.uid() = user_id);
create policy "ai_analyses_update_own" on public.ai_analyses for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ai_analyses_delete_own" on public.ai_analyses for delete using (auth.uid() = user_id);

drop policy if exists "ai_mistake_analyses_select_own" on public.ai_mistake_analyses;
drop policy if exists "ai_mistake_analyses_insert_own" on public.ai_mistake_analyses;
drop policy if exists "ai_mistake_analyses_update_own" on public.ai_mistake_analyses;
drop policy if exists "ai_mistake_analyses_delete_own" on public.ai_mistake_analyses;
create policy "ai_mistake_analyses_select_own" on public.ai_mistake_analyses for select using (auth.uid() = user_id);
create policy "ai_mistake_analyses_insert_own" on public.ai_mistake_analyses for insert with check (auth.uid() = user_id);
create policy "ai_mistake_analyses_update_own" on public.ai_mistake_analyses for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ai_mistake_analyses_delete_own" on public.ai_mistake_analyses for delete using (auth.uid() = user_id);

-- These tables are written only by the ai-analysis / ai-mistake-analysis edge
-- functions (using the caller's own JWT, so RLS above still applies - no
-- service-role bypass is used or required).
