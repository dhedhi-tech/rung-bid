-- Where new players came from: Google Play install referrer (app) or ?ref= from a share link (website).
-- One row per phone (player id). Shown on the admin page.
create table if not exists public.install_sources (
  pid text primary key,
  at timestamptz not null default now(),   -- when we got it (first open of the new app version)
  installed_at timestamptz,                -- when the Play install started (app only)
  app boolean not null default false,
  ref text,                                -- raw referrer, e.g. utm_source=share_win
  source text,                             -- utm_source (google-play, share_win, website, ...)
  medium text                              -- utm_medium (organic, home, game_over, ...)
);
create index if not exists install_sources_at on public.install_sources (at);
alter table public.install_sources enable row level security;
