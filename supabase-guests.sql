-- Guest profiles: players who have not signed in keep XP, level, coins, felts and picture on their phone's player id.
-- When they sign in with Google, everything moves into their account and the guest row is deleted.
-- Paste into Supabase: SQL Editor -> New query -> Run. Safe to run more than once.
create table if not exists public.guest_profiles (
  id text primary key,            -- the phone's player id (pid)
  name text,
  avatar text default '',
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
  pic text,
  created_at timestamptz not null default now()
);
-- Only the game server (service key) reads and writes it
alter table public.guest_profiles enable row level security;
revoke all on public.guest_profiles from anon, authenticated;
