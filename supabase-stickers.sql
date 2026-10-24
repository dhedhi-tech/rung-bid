-- Stickers uploaded on the admin page. Paste into Supabase: SQL Editor -> New query -> Run. Safe to run more than once.
create table if not exists public.stickers (
  id text primary key,
  line text not null,
  data text not null,                       -- the picture (PNG, JPG, WebP or SVG)
  created_at timestamptz not null default now()
);
alter table public.stickers enable row level security;   -- only the game server can read or write
