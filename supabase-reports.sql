-- Player reports for the admin page. Paste into Supabase: SQL Editor -> New query -> Run. Safe to run more than once.
create table if not exists public.reports (
  id bigserial primary key,
  at timestamptz not null default now(),
  table_code text,
  reason text not null,
  reporter_name text,
  reporter_pid text,
  reporter_uid text,      -- account id if signed in
  reported_name text,
  reported_pid text,
  reported_uid text,
  chat jsonb              -- the reported player's last messages at that table
);
create index if not exists reports_at on public.reports (at desc);
-- Only the game server (service key) can read or write it
alter table public.reports enable row level security;
