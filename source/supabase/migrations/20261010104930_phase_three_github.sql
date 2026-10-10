-- GitHub evidence is separate from canonical tasks and recorded intervals.
alter table orderly_private.connections drop constraint connections_provider_check;
alter table orderly_private.connections add constraint connections_provider_check check(provider in ('asana','notion','github'));
create table orderly_private.pull_requests (
 id text primary key, user_id text not null, source_id text not null, external_id text not null,
 metadata jsonb not null, available boolean not null default true, seen_run text not null,
 unique(id,user_id), unique(source_id,external_id),
 foreign key(source_id,user_id) references orderly_private.sources(id,user_id)
);
create table orderly_private.pr_links (
 pr_id text not null, task_id text not null, user_id text not null,
 status text not null check(status in ('suggested','confirmed','rejected')), reason text not null,
 primary key(pr_id,task_id),
 foreign key(pr_id,user_id) references orderly_private.pull_requests(id,user_id),
 foreign key(task_id,user_id) references orderly_private.tasks(id,user_id)
);
create table orderly_private.pr_events (
 pr_id text not null, user_id text not null, kind text not null, at bigint not null,
 primary key(pr_id,kind,at), foreign key(pr_id,user_id) references orderly_private.pull_requests(id,user_id)
);
create table orderly_private.pr_audit (
 id text primary key, pr_id text not null, task_id text not null, user_id text not null,
 before_status text, after_status text not null, at bigint not null,
 foreign key(pr_id,user_id) references orderly_private.pull_requests(id,user_id),
 foreign key(task_id,user_id) references orderly_private.tasks(id,user_id)
);
create index pr_owner_source on orderly_private.pull_requests(user_id,source_id);
create index pr_links_task on orderly_private.pr_links(user_id,task_id);
create index pr_events_owner on orderly_private.pr_events(user_id,at);
create index pr_audit_owner on orderly_private.pr_audit(user_id,at);
create index pr_audit_task on orderly_private.pr_audit(user_id,task_id);
create index pr_audit_pr on orderly_private.pr_audit(pr_id,user_id);
create index github_installation_sources on orderly_private.sources((mapping->>'installation'));

create function public.orderly_github(owner text, command text, input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c orderly_private.connections; p orderly_private.pull_requests; l orderly_private.pr_links;
 tid text; desired text; now_ms bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
begin
 perform 1 from orderly_private.users where id=owner for update;
 if not found then perform orderly_private.fail('Sign in to continue.',401); end if;
 if command='list' then
 return jsonb_build_object(
 'connections',coalesce((select jsonb_agg(to_jsonb(x)-array['credentials','read_lease','read_until']) from orderly_private.connections x where user_id=owner and provider='github'),'[]'::jsonb),
 'sources',coalesce((select jsonb_agg(to_jsonb(x)-array['webhook_secret','webhook_token']) from orderly_private.sources x join orderly_private.connections conn on conn.id=x.connection_id where x.user_id=owner and conn.provider='github'),'[]'::jsonb),
 'pulls',coalesce((select jsonb_agg((to_jsonb(x)-'seen_run')||jsonb_build_object('available',x.available and conn.status='connected' and src.status not in ('inaccessible','reconnect','disconnected'))) from orderly_private.pull_requests x join orderly_private.sources src on src.id=x.source_id join orderly_private.connections conn on conn.id=src.connection_id where x.user_id=owner),'[]'::jsonb),
 'links',coalesce((select jsonb_agg(to_jsonb(x)) from orderly_private.pr_links x where user_id=owner),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(x)) from orderly_private.pr_events x where user_id=owner),'[]'::jsonb),
 'audit',coalesce((select jsonb_agg(to_jsonb(x)-'id') from orderly_private.pr_audit x where user_id=owner),'[]'::jsonb));
 elsif command='connect' then
 if not exists(select 1 from orderly_private.sessions where token=input->>'session' and user_id=owner and expires>now_ms) then perform orderly_private.fail('Sign in again before connecting GitHub.',401); end if;
 return public.orderly_integrations(owner,'connect',input);
 elsif command='references' then
 return coalesce((select jsonb_agg(jsonb_build_object('task_id',e.task_id,'external_id',e.external_id,'url',e.metadata->>'url','provider',conn.provider))
 from orderly_private.external_tasks e join orderly_private.connections conn on conn.id=e.connection_id where e.user_id=owner and e.task_id is not null and conn.provider in ('asana','notion')),'[]'::jsonb);
 elsif command in ('link','reject','unlink','local') then
 select * into p from orderly_private.pull_requests where id=input->>'prId' and user_id=owner for update;
 if not found then perform orderly_private.fail('Pull request not found.',404); end if;
 if command='local' then
 perform orderly_private.owned('projects',input->'projectId',owner);
 -- Retries cannot create a second standalone task for the same PR.
 select x.task_id into tid from orderly_private.pr_links x where x.pr_id=p.id and x.reason='Created from PR';
 if tid is null then
 tid:=gen_random_uuid()::text;
 insert into orderly_private.tasks values(tid,owner,input->>'projectId',left(p.metadata->>'title',200));
 end if;
 else
 perform orderly_private.owned('tasks',input->'taskId',owner); tid:=input->>'taskId';
 end if;
 select * into l from orderly_private.pr_links where pr_id=p.id and task_id=tid for update;
 desired:=case when command in ('reject','unlink') then 'rejected' else 'confirmed' end;
 if l.status is distinct from desired then
 insert into orderly_private.pr_audit values(gen_random_uuid()::text,p.id,tid,owner,l.status,desired,now_ms);
 insert into orderly_private.pr_links values(p.id,tid,owner,desired,case when command='local' then 'Created from PR' else coalesce(l.reason,'Explicit selection') end)
 on conflict(pr_id,task_id) do update set status=excluded.status;
 end if;
 return to_jsonb(tid);
 end if;
 select * into c from orderly_private.connections where id=input->>'connectionId' and user_id=owner and provider='github' for update;
 if not found then perform orderly_private.fail('GitHub connection not found.',404); end if;
 if command='disconnect' then
 update orderly_private.pull_requests pr set available=false from orderly_private.sources src where pr.source_id=src.id and src.connection_id=c.id;
 return public.orderly_integrations(owner,command,input);
 elsif command in ('credential','read_release','read_credentials','resync') then
 return public.orderly_integrations(owner,command,input);
 elsif command='map' then
 if c.read_lease is distinct from input->>'lease' or c.read_until<=now_ms or c.generation<>(input->>'generation')::integer then perform orderly_private.fail('GitHub configuration changed. Retry mapping.',409); end if;
 if coalesce(input->'mapping'->>'installation','') !~ '^[1-9][0-9]{0,19}$' or coalesce(input->'mapping'->>'fullName','') !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' then perform orderly_private.fail('Choose a valid GitHub repository.'); end if;
 return public.orderly_integrations(owner,'map',input);
 end if;
 perform orderly_private.fail('Unknown GitHub action.'); return null;
end $$;

-- Reuse the existing durable queue and its fenced page completion. Preserve board behavior.
alter function public.orderly_sync(text,jsonb) rename to orderly_board_sync;
create function public.orderly_sync(command text, input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c orderly_private.connections; s orderly_private.sources; j orderly_private.sync_jobs;
 p orderly_private.pull_requests; item jsonb; suggestion jsonb; event_kind text; event_at bigint;
 now_ms bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
begin
 if command='github_event' then
 -- Verified server payloads only. Lock owner -> connection -> source -> queue.
 for c in select * from orderly_private.connections where provider='github' and status<>'disconnected'
 and ((input->>'event'='github_app_authorization' and account_id=input->>'userId') or exists(
 select 1 from orderly_private.sources src where src.connection_id=orderly_private.connections.id and src.mapping->>'installation'=input->>'installation')) order by user_id,id loop
 perform 1 from orderly_private.users where id=c.user_id for update;
 perform 1 from orderly_private.connections where id=c.id for update;
 insert into orderly_private.sync_events values(c.id,input->>'delivery',now_ms) on conflict do nothing;
 if not found then continue; end if;
 if input->>'event'='github_app_authorization' and input->>'action'='revoked' then
 update orderly_private.connections set status='reconnect',credentials=null,generation=generation+1,read_lease=null,read_until=null,error='GitHub authorization was revoked.' where id=c.id;
 delete from orderly_private.sync_jobs where source_id in (select id from orderly_private.sources where connection_id=c.id);
 update orderly_private.sources set status='reconnect',generation=generation+1 where connection_id=c.id;
 update orderly_private.pull_requests pr set available=false from orderly_private.sources src where pr.source_id=src.id and src.connection_id=c.id;
 continue;
 end if;
 for s in select * from orderly_private.sources where connection_id=c.id and mapping->>'installation'=input->>'installation'
 and (input->>'event'<>'pull_request' or external_id=input->>'repository') order by id for update loop
 if (input->>'event'='installation' and input->>'action' in ('deleted','suspend')) or
 (input->>'event'='installation_repositories' and coalesce(input->'removed','[]'::jsonb) ? s.external_id) then
 update orderly_private.sources set status='inaccessible',error='GitHub installation or repository access was removed.',generation=generation+1 where id=s.id;
 delete from orderly_private.sync_jobs where source_id=s.id;
 update orderly_private.pull_requests set available=false where source_id=s.id;
 else
 -- Grants/unsuspend must be rechecked canonically; never restore from an event body.
 perform orderly_private.enqueue(s.id);
 end if;
 end loop;
 end loop;
 return '{}'::jsonb;
 elsif command='github_page' then
 select x.* into c from orderly_private.connections x join orderly_private.sources y on y.connection_id=x.id join orderly_private.sync_jobs z on z.source_id=y.id where z.id=input->>'jobId';
 if not found or c.provider<>'github' then perform orderly_private.fail('GitHub lease retired.',409); end if;
 perform 1 from orderly_private.users where id=c.user_id for update;
 perform 1 from orderly_private.connections where id=c.id for update;
 select y.* into s from orderly_private.sources y join orderly_private.sync_jobs z on z.source_id=y.id where z.id=input->>'jobId' for update of y;
 select * into j from orderly_private.sync_jobs where id=input->>'jobId' for update;
 select * into c from orderly_private.connections where id=c.id;
 if j.lease is distinct from input->>'lease' or j.lease_until<=now_ms or c.status<>'connected' or c.generation<>j.connection_generation or s.generation<>j.generation then perform orderly_private.fail('GitHub sync configuration changed.',409); end if;
 for item in select value from jsonb_array_elements(input->'pulls') loop
 select * into p from orderly_private.pull_requests where source_id=s.id and external_id=item->'metadata'->>'id' for update;
 if not found then
 insert into orderly_private.pull_requests values(gen_random_uuid()::text,c.user_id,s.id,item->'metadata'->>'id',item->'metadata',true,j.run_id) returning * into p;
 else
 -- Stale reads cannot regress PR state; still mark presence in this scan.
 update orderly_private.pull_requests set metadata=case when (item->'metadata'->>'updatedAt')::bigint >= (metadata->>'updatedAt')::bigint then item->'metadata' else metadata end,available=true,seen_run=j.run_id where id=p.id returning * into p;
 end if;
 insert into orderly_private.pr_events values(p.id,c.user_id,'created',(p.metadata->>'createdAt')::bigint) on conflict do nothing;
 event_kind:=p.metadata->>'state';
 event_at:=case when event_kind='merged' then (p.metadata->>'mergedAt')::bigint when event_kind='closed' then (p.metadata->>'closedAt')::bigint else (p.metadata->>'updatedAt')::bigint end;
 insert into orderly_private.pr_events values(p.id,c.user_id,event_kind,event_at) on conflict do nothing;
 if (item->'metadata'->>'updatedAt')::bigint < (p.metadata->>'updatedAt')::bigint then continue; end if;
 delete from orderly_private.pr_links where pr_id=p.id and status='suggested';
 for suggestion in select value from jsonb_array_elements(item->'suggestions') loop
 if exists(select 1 from orderly_private.tasks where id=suggestion->>'taskId' and user_id=c.user_id) then
 insert into orderly_private.pr_links values(p.id,suggestion->>'taskId',c.user_id,'suggested',left(suggestion->>'reason',1000)) on conflict(pr_id,task_id) do update set reason=excluded.reason where orderly_private.pr_links.status='suggested';
 end if;
 end loop;
 end loop;
 if coalesce(input->>'cursor','')='' then
 update orderly_private.pull_requests set available=false where source_id=s.id and seen_run<>j.run_id;
 end if;
 -- Existing completion owns cursor, retry, dirty follow-up, and reconciliation timestamps.
 return public.orderly_board_sync('page',(input-'pulls')||jsonb_build_object('tasks','[]'::jsonb));
 elsif command='fail' then
 -- Keep historical evidence, but communicate access loss immediately.
 if input->>'status' in ('inaccessible','reconnect') then
 -- Validate fence before changing evidence. Board function locks and rechecks it.
 select y.* into s from orderly_private.sources y join orderly_private.sync_jobs z on z.source_id=y.id where z.id=input->>'jobId';
 perform public.orderly_board_sync(command,input);
 update orderly_private.pull_requests set available=false where source_id=s.id;
 return '{}'::jsonb;
 end if;
 end if;
 return public.orderly_board_sync(command,input);
end $$;

do $$ declare t text; begin
 foreach t in array array['pull_requests','pr_links','pr_events','pr_audit'] loop
 execute format('alter table orderly_private.%I enable row level security',t);
 execute format('revoke all on orderly_private.%I from public,anon,authenticated',t);
 execute format('grant select,insert,update,delete on orderly_private.%I to service_role',t);
 end loop;
end $$;
revoke execute on function public.orderly_github(text,text,jsonb),public.orderly_sync(text,jsonb),public.orderly_board_sync(text,jsonb) from public,anon,authenticated;
grant execute on function public.orderly_github(text,text,jsonb),public.orderly_sync(text,jsonb),public.orderly_board_sync(text,jsonb) to service_role;

-- Board relinking may clean up an unused auto-created task. Evidence keeps its identity.
create function orderly_private.retain_evidence_task() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from orderly_private.pr_links where user_id=old.user_id and task_id=old.id) or exists(select 1 from orderly_private.pr_audit where user_id=old.user_id and task_id=old.id) then return null; end if;
 return old;
end $$;
create trigger retain_evidence_task before delete on orderly_private.tasks for each row execute function orderly_private.retain_evidence_task();
revoke execute on function orderly_private.retain_evidence_task() from public,anon,authenticated;
grant execute on function orderly_private.retain_evidence_task() to service_role;
