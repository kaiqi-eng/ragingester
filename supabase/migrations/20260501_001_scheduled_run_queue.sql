-- Queue scheduled card runs through collection_runs.
-- The claim function allows only one scheduled run to be running globally.

create or replace function public.claim_next_scheduled_run()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_run public.collection_runs%rowtype;
  claimed_card public.cards%rowtype;
begin
  if not pg_try_advisory_xact_lock(hashtext('claim_next_scheduled_run')::bigint) then
    return null;
  end if;

  if exists (
    select 1
    from public.collection_runs
    where status = 'running'
      and trigger_mode = 'scheduled'
  ) then
    return null;
  end if;

  select *
  into claimed_run
  from public.collection_runs
  where status = 'pending'
    and trigger_mode = 'scheduled'
  order by created_at asc
  limit 1
  for update skip locked;

  if not found then
    return null;
  end if;

  update public.collection_runs
  set status = 'running'
  where id = claimed_run.id
  returning * into claimed_run;

  select *
  into claimed_card
  from public.cards
  where id = claimed_run.card_id;

  if not found then
    update public.collection_runs
    set
      status = 'failed',
      ended_at = now(),
      error = 'card not found',
      error_payload = jsonb_build_object('name', 'Error', 'message', 'card not found')
    where id = claimed_run.id;

    return null;
  end if;

  return jsonb_build_object(
    'run', to_jsonb(claimed_run),
    'card', to_jsonb(claimed_card)
  );
end;
$$;
