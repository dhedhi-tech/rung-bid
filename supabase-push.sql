-- Push notifications: one row per phone (player id) that allowed notifications in the app.
create table if not exists public.push_tokens (
  pid text primary key,
  uid text,                                  -- account id when signed in (friend invites need it)
  token text not null,                       -- Firebase token for this phone
  last_seen timestamptz,                     -- last time the app was opened
  last_push timestamptz,                     -- last come-back reminder sent
  pushes_since_seen int not null default 0,  -- reminders since they last opened the app (stop at 3)
  updated_at timestamptz default now()
);
create index if not exists push_tokens_uid on public.push_tokens (uid);
create index if not exists push_tokens_seen on public.push_tokens (last_seen);
alter table public.push_tokens enable row level security;
