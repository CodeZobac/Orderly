-- One private RPC round trip; retain independent Orderly sessions and all
-- existing transactional mutation/idempotency/ownership rules.
create function public.orderly_work(session_hash text, command text, input jsonb, at_ms bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id text;
  outcome jsonb;
  state jsonb;
  started timestamptz := clock_timestamp();
  authenticated timestamptz;
  mutated timestamptz;
  finished timestamptz;
begin
  if command not in ('read','mutate') or command is null then
    perform orderly_private.fail('Unknown work operation.',400);
  end if;
  owner_id := public.orderly_auth('session', jsonb_build_object(
    'token',session_hash,'now',floor(extract(epoch from clock_timestamp())*1000)::bigint
  )) #>> '{}';
  authenticated := clock_timestamp();
  if command='mutate' then
    outcome := public.orderly_mutate(owner_id,input,at_ms);
  end if;
  mutated := clock_timestamp();
  -- Snapshot failure rolls the mutation back, rather than failing after commit.
  state := public.orderly_snapshot(owner_id);
  finished := clock_timestamp();
  return jsonb_build_object('data',state,'result',outcome,'timing',jsonb_build_object(
    'auth',extract(epoch from (authenticated-started))*1000,
    'mutation',extract(epoch from (mutated-authenticated))*1000,
    'snapshot',extract(epoch from (finished-mutated))*1000
  ));
end;
$$;
revoke execute on function public.orderly_work(text,text,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.orderly_work(text,text,jsonb,bigint) to service_role;
