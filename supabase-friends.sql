-- Friends for signed-in players. Paste into Supabase: SQL Editor -> New query -> Run. Safe to run more than once.
create table if not exists public.friends (
  a uuid not null references auth.users(id) on delete cascade,   -- who sent the request
  b uuid not null references auth.users(id) on delete cascade,   -- who received it
  status text not null default 'pending',                        -- 'pending' or 'accepted'
  created_at timestamptz not null default now(),
  primary key (a, b)
);
create index if not exists friends_b on public.friends (b);
alter table public.friends enable row level security;   -- only the game server can read or write
