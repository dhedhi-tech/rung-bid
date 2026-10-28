-- Who plays in the Android app (for the admin page). Paste into Supabase: SQL Editor -> New query -> Run. Safe to run more than once.
-- One row per player per day they opened the app; uid is filled when they are signed in with Google.
create table if not exists public.app_days (
  day date not null,
  pid text not null,
  uid text,
  primary key (day, pid)
);
create index if not exists app_days_uid on public.app_days (uid);
-- Only the game server (service key) can read or write it
alter table public.app_days enable row level security;
