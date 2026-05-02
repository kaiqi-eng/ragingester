-- Per-card run policy overrides.
-- NULL means "use global defaults from API config".

alter table public.cards
add column if not exists run_timeout_ms integer,
add column if not exists run_max_retries integer;

alter table public.cards
drop constraint if exists cards_run_timeout_ms_range,
add constraint cards_run_timeout_ms_range check (
  run_timeout_ms is null or (run_timeout_ms between 1000 and 300000)
);

alter table public.cards
drop constraint if exists cards_run_max_retries_range,
add constraint cards_run_max_retries_range check (
  run_max_retries is null or (run_max_retries between 0 and 5)
);
