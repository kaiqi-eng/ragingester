-- Ensure overlap protection at the database level:
-- only one pending/running run may exist for a card at a time.

create unique index if not exists one_active_run_per_card
on public.collection_runs (card_id)
where status in ('pending', 'running');
