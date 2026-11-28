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
