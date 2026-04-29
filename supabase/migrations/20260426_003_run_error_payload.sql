-- Persist structured run failure payload in addition to error text/logs.

alter table public.collection_runs
add column if not exists error_payload jsonb;
