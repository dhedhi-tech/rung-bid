-- How far each new player gets in their very first game (admin page "First games").
-- Paste into Supabase: SQL Editor -> New query -> Run. Safe to run more than once.
create table if not exists public.first_games (
  pid text primary key,          -- the phone's player id
  name text,                     -- name at the time (usually "Guest NNN")
  uid text,                      -- account id if signed in
  app boolean default false,     -- opened in the Android app
  code text,                     -- table code
  tries int default 1,           -- how many times they tapped Start before finishing a first game
  started_at timestamptz default now(),
  updated_at timestamptz default now(),
  step text,                     -- furthest step: started, bid, trump, card, hand, finished
  hands int default 0,           -- hands completed
  lim int,                       -- hands in the game (6 = Quick)
  tutorial boolean,              -- tutorial on at some point in the game
  finished boolean default false,
  won boolean,
  left_early boolean default false  -- left the table before the game ended
);
alter table public.first_games enable row level security;
-- Only the game server (service key) can read or write it
revoke all on public.first_games from anon, authenticated;

-- Nov 20 2026: how they left, what was on screen, where they went next
alter table public.first_games add column if not exists left_how text, add column if not exists last_seen text, add column if not exists then_joined text;

-- Nov 22 2026: real time played in the first game, and when they were last seen and what they did
alter table public.first_games add column if not exists play_secs int, add column if not exists last_at timestamptz, add column if not exists last_did text, add column if not exists now_name text;
