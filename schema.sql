-- ============================================================
-- SQL для Supabase: SQL Editor → New query → вставить и Run
-- ============================================================

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content text not null check (char_length(content) <= 2000),
  created_at timestamptz not null default now()
);

-- Сортировка по дате (список идёт от новой к старой)
create index if not exists entries_user_created_idx
  on public.entries (user_id, created_at desc);

-- Включаем защиту на уровне строк (RLS)
alter table public.entries enable row level security;

drop policy if exists "single user own rows" on public.entries;

create policy "single user own rows" on public.entries
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);