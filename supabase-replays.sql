-- Hand replays (Nov 28 2026): the moves of each finished hand, kept 7 days (the server deletes older rows)
create table if not exists replays (
  id text primary key,
  code text,
  n int,
  joker boolean,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists replays_created on replays (created_at);
alter table replays enable row level security; -- only the server (service key) reads and writes

-- My last games (Nov 28 2026): one row per game with its hands (replay ids), so players can watch replays later
create table if not exists replay_games (
  id text primary key,
  pids text[] not null default '{}',
  uids text[] not null default '{}',
  data jsonb not null,
  upd timestamptz not null default now()
);
create index if not exists replay_games_upd on replay_games (upd);
create index if not exists replay_games_pids on replay_games using gin (pids);
create index if not exists replay_games_uids on replay_games using gin (uids);
alter table replay_games enable row level security;
