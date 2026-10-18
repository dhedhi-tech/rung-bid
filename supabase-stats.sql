-- Game stats for the admin page. Paste into Supabase: SQL Editor -> New query -> Run. Safe to run more than once.

-- One row per player per day they opened the game (guests included)
create table if not exists public.player_days (
  day date not null,
  pid text not null,
  signed boolean not null default false,
  primary key (day, pid)
);
create index if not exists player_days_pid on public.player_days (pid, day);

-- One row when a game starts and one when it finishes
create table if not exists public.game_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null,          -- 'start' or 'finish'
  code text,
  n int,                        -- 4, 6 or 8 players
  joker boolean,
  lim int,                      -- hand limit: 6, 10 or 0 (full)
  humans int,                   -- real people at the table
  signed int,                   -- of those, signed in with Google
  hands int                     -- hands played (on finish)
);
create index if not exists game_log_at on public.game_log (at);

-- Only the game server (service key) can read or write these
alter table public.player_days enable row level security;
alter table public.game_log enable row level security;

-- Daily summary (Pakistan time)
create or replace view public.admin_daily with (security_invoker = true) as
with p as (
  select pd.day,
         count(*) as players,
         count(*) filter (where pd.signed) as signed_players,
         count(*) filter (where not exists (select 1 from public.player_days o where o.pid = pd.pid and o.day < pd.day)) as new_players
  from public.player_days pd group by pd.day
), g as (
  select (at at time zone 'Asia/Karachi')::date as day,
         count(*) filter (where kind = 'start') as games_started,
         count(*) filter (where kind = 'finish') as games_finished,
         coalesce(sum(hands) filter (where kind = 'finish'), 0) as hands,
         count(*) filter (where kind = 'start' and joker) as joker_games,
         count(*) filter (where kind = 'start' and n = 4) as p4,
         count(*) filter (where kind = 'start' and n = 6) as p6,
         count(*) filter (where kind = 'start' and n = 8) as p8,
         count(*) filter (where kind = 'start' and humans = 1) as bot_games
  from public.game_log group by 1
), s as (
  select (created_at at time zone 'Asia/Karachi')::date as day, count(*) as signups
  from public.profiles group by 1
), d as (select day from p union select day from g union select day from s)
select d.day,
       coalesce(p.players, 0) as players, coalesce(p.signed_players, 0) as signed_players, coalesce(p.new_players, 0) as new_players,
       coalesce(s.signups, 0) as signups,
       coalesce(g.games_started, 0) as games_started, coalesce(g.games_finished, 0) as games_finished, coalesce(g.hands, 0) as hands,
       coalesce(g.joker_games, 0) as joker_games, coalesce(g.p4, 0) as p4, coalesce(g.p6, 0) as p6, coalesce(g.p8, 0) as p8,
       coalesce(g.bot_games, 0) as bot_games
from d left join p using (day) left join g using (day) left join s using (day);
revoke all on public.admin_daily from anon, authenticated;
