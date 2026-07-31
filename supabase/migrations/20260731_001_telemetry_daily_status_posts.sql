-- Durable idempotency for daily status Slack posts (one card per system + UTC date).

create table if not exists public.telemetry_daily_status_posts (
  system text not null,
  date date not null,
  posted_at timestamptz not null default now(),
  run_id text not null,
  primary key (system, date)
);

comment on table public.telemetry_daily_status_posts is
  'Tracks posted daily status Slack cards so restarts do not double-post for the same (system, date).';
