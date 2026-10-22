-- Patta Party player profiles. Paste into Supabase: SQL Editor -> New query -> Run.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  avatar text,
  xp integer not null default 0,
  coins integer not null default 50,
  games integer not null default 0,
  wins integer not null default 0,
  hands integer not null default 0,
  hand_wins integer not null default 0,
  bids_made integer not null default 0,
  bids_total integer not null default 0,
  sweeps integer not null default 0,
  last_daily date,
  owned jsonb not null default '["green"]'::jsonb,
  equipped jsonb not null default '{"felt":"green"}'::jsonb,
  created_at timestamptz not null default now()
);
-- Only the game server (service key) reads and writes profiles
alter table public.profiles enable row level security;

-- Profile picture (added later). Safe to run more than once.
alter table public.profiles add column if not exists pic text;

-- Leaderboard (added later). Light view without uploaded photo data. Safe to run more than once.
create or replace view public.leaderboard with (security_invoker = true) as
  select id, name, avatar, case when pic like 'data:%' then 'u' else pic end as pic, xp, games, wins
  from public.profiles;
revoke all on public.leaderboard from anon, authenticated;
