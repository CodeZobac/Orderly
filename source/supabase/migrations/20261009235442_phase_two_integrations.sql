-- Private, server-only integration state. Provider metadata never writes entries.
create table orderly_private.connections (
 id text primary key, user_id text not null references orderly_private.users(id),
 provider text not null check(provider in ('asana','notion')), account_id text not null,
 label text not null, credentials text, read_lease text, read_until bigint, generation integer not null default 1,
 status text not null default 'connected', error text, unique(id,user_id), unique(user_id,provider,account_id)
);
create table orderly_private.oauth_states (
 hash text primary key, user_id text not null references orderly_private.users(id),
 provider text not null, verifier text not null, expires bigint not null, session_token text not null
);
create table orderly_private.sources (
 id text primary key, user_id text not null, connection_id text not null, external_id text not null,
 name text not null, project_id text not null, mapping jsonb not null, generation integer not null default 1,
 status text not null default 'queued', error text, last_success bigint, next_sync bigint not null default 0,
 webhook_token text, webhook_secret text, webhook_id text, webhook_expires bigint,
 unique(id,user_id), unique(connection_id,external_id),
 foreign key(connection_id,user_id) references orderly_private.connections(id,user_id),
 foreign key(project_id,user_id) references orderly_private.projects(id,user_id)
);
create table orderly_private.external_tasks (
 id text primary key, user_id text not null, connection_id text not null, external_id text not null,
 task_id text, metadata jsonb not null, explicit_link boolean not null default false,
 unique(id,user_id), unique(connection_id,external_id),
 foreign key(connection_id,user_id) references orderly_private.connections(id,user_id),
 foreign key(task_id,user_id) references orderly_private.tasks(id,user_id)
);
create table orderly_private.source_tasks (
 source_id text not null, external_task_id text not null, user_id text not null,
 seen_run text not null, available boolean not null default true, primary key(source_id,external_task_id),
 foreign key(source_id,user_id) references orderly_private.sources(id,user_id),
 foreign key(external_task_id,user_id) references orderly_private.external_tasks(id,user_id)
);
create table orderly_private.sync_jobs (
 id text primary key, source_id text not null unique references orderly_private.sources(id),
 generation integer not null, connection_generation integer not null, cursor text,
 run_id text not null, attempts integer not null default 0, available_at bigint not null default 0,
 lease text, lease_until bigint, dirty boolean not null default false
);
create table orderly_private.sync_events (
 connection_id text not null references orderly_private.connections(id), event_id text not null,
 received_at bigint not null, primary key(connection_id,event_id)
);
create index connections_owner on orderly_private.connections(user_id);
create unique index sources_webhook_token on orderly_private.sources(webhook_token) where webhook_token is not null;
create index sources_owner on orderly_private.sources(user_id);
create index external_tasks_owner on orderly_private.external_tasks(user_id,task_id);
create index source_tasks_external on orderly_private.source_tasks(external_task_id);
create index sync_jobs_due on orderly_private.sync_jobs(available_at);

create function orderly_private.enqueue(source text, dirty_running boolean default true) returns void
language plpgsql security invoker set search_path='' as $$
begin
 insert into orderly_private.sync_jobs(id,source_id,generation,connection_generation,run_id)
 select gen_random_uuid()::text,s.id,s.generation,c.generation,gen_random_uuid()::text
 from orderly_private.sources s join orderly_private.connections c on c.id=s.connection_id
 where s.id=source and c.status='connected'
 on conflict(source_id) do update set dirty=orderly_private.sync_jobs.dirty or dirty_running;
end $$;

-- Only authenticated Next routes supply owner. No credentials in UI snapshots.
create function public.orderly_integrations(owner text, command text, input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c orderly_private.connections; s orderly_private.sources; e orderly_private.external_tasks;
 v jsonb; rid text; now_ms bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
begin
 perform 1 from orderly_private.users where id=owner for update;
 if not found then perform orderly_private.fail('Sign in to continue.',401); end if;
 if command='state' then
 delete from orderly_private.oauth_states where expires<now_ms;
 insert into orderly_private.oauth_states values(input->>'hash',owner,input->>'provider',input->>'verifier',now_ms+600000,input->>'session');
 return '{}'::jsonb;
 end if;
 if command='connect' then
 insert into orderly_private.connections(id,user_id,provider,account_id,label,credentials)
 values(gen_random_uuid()::text,owner,input->>'provider',input->>'account',input->>'label',input->>'credentials')
 on conflict(user_id,provider,account_id) do update set credentials=excluded.credentials,label=excluded.label,
 generation=orderly_private.connections.generation+1,status='connected',error=null,read_lease=null,read_until=null returning id into rid;
 delete from orderly_private.sync_jobs where source_id in (select id from orderly_private.sources where connection_id=rid);
 for s in select * from orderly_private.sources where connection_id=rid loop perform orderly_private.enqueue(s.id); end loop;
 return to_jsonb(rid);
 end if;
 if command='list' then
 return jsonb_build_object(
 'connections',coalesce((select jsonb_agg(to_jsonb(t)-array['credentials','read_lease','read_until']) from orderly_private.connections t where user_id=owner),'[]'::jsonb),
 'sources',coalesce((select jsonb_agg(to_jsonb(t)-array['webhook_secret','webhook_token']) from orderly_private.sources t where user_id=owner),'[]'::jsonb),
 'tasks',coalesce((select jsonb_agg(to_jsonb(t)) from orderly_private.external_tasks t where user_id=owner),'[]'::jsonb),
 'memberships',coalesce((select jsonb_agg(to_jsonb(t)) from orderly_private.source_tasks t where user_id=owner),'[]'::jsonb));
 end if;
 if command='link' then
 select * into e from orderly_private.external_tasks where id=input->>'externalTaskId' and user_id=owner for update;
 if not found then perform orderly_private.fail('Imported task not found.',404); end if;
 if e.task_id is not null and e.task_id is distinct from input->>'taskId' and exists(select 1 from orderly_private.entries where task_id=e.task_id) then
 perform orderly_private.fail('This task has recorded time. Keep its attribution; link before tracking.',409); end if;
 if coalesce(input->>'taskId','')<>'' then
 v:=orderly_private.owned('tasks',input->'taskId',owner); rid:=v->>'id';
 else
 perform orderly_private.owned('projects',input->'projectId',owner);
 rid:=gen_random_uuid()::text;
 insert into orderly_private.tasks values(rid,owner,input->>'projectId',left(coalesce(nullif(e.metadata->>'name',''),'Untitled task'),200));
 end if;
 update orderly_private.external_tasks set task_id=rid,explicit_link=true where id=e.id;
 if e.task_id is not null and e.task_id<>rid and not e.explicit_link then
 delete from orderly_private.tasks t where t.id=e.task_id and t.user_id=owner
 and not exists(select 1 from orderly_private.entries where task_id=t.id)
 and not exists(select 1 from orderly_private.external_tasks where task_id=t.id); end if;
 return to_jsonb(rid);
 end if;
 select * into c from orderly_private.connections where id=input->>'connectionId' and user_id=owner for update;
 if not found then perform orderly_private.fail('Connection not found.',404); end if;
 if command='disconnect' then
 update orderly_private.connections set credentials=null,read_lease=null,read_until=null,generation=generation+1,status='disconnected',error=null where id=c.id;
 delete from orderly_private.sync_jobs where source_id in (select id from orderly_private.sources where connection_id=c.id);
 update orderly_private.sources set status='disconnected',webhook_secret=null,webhook_token=null where connection_id=c.id;
 return '{}'::jsonb;
 end if;
 if c.status<>'connected' then perform orderly_private.fail('Reconnect this provider first.',409); end if;
 if command='read_release' then
 update orderly_private.connections set read_lease=null,read_until=null where id=c.id and read_lease=input->>'lease'; return '{}'::jsonb;
 end if;
 if command='read_credentials' then
 if c.read_lease is distinct from input->>'lease' or c.read_until<=now_ms or c.generation<>(input->>'generation')::integer then perform orderly_private.fail('Provider lease expired.',409); end if;
 update orderly_private.connections set credentials=input->>'credentials' where id=c.id; return '{}'::jsonb;
 end if;
 if command='credential' then
 if c.read_until>now_ms or exists(select 1 from orderly_private.sync_jobs z join orderly_private.sources y on y.id=z.source_id where y.connection_id=c.id and z.lease_until>now_ms) then perform orderly_private.fail('Sync is using this connection. Retry shortly.',409); end if;
 update orderly_private.connections set read_lease=input->>'lease',read_until=now_ms+180000 where id=c.id;
 return to_jsonb(c); end if;
 if command='map' then
 perform orderly_private.owned('projects',input->'projectId',owner);
 if jsonb_typeof(input->'mapping') is distinct from 'object' then perform orderly_private.fail('Choose source properties.'); end if;
 insert into orderly_private.sources(id,user_id,connection_id,external_id,name,project_id,mapping)
 values(gen_random_uuid()::text,owner,c.id,orderly_private.label(input->'externalId','Source ID'),orderly_private.label(input->'name','Source name'),input->>'projectId',input->'mapping')
 on conflict(connection_id,external_id) do update set name=excluded.name,project_id=excluded.project_id,mapping=excluded.mapping,
 generation=orderly_private.sources.generation+1,status='queued',error=null returning * into s;
 delete from orderly_private.sync_jobs where source_id=s.id;
 perform orderly_private.enqueue(s.id); return to_jsonb(s.id);
 end if;
 select * into s from orderly_private.sources where id=input->>'sourceId' and connection_id=c.id for update;
 if not found then perform orderly_private.fail('Source not found.',404); end if;
 if command='resync' then
 -- A failed scan can restart with a fresh cursor; an active scan gets a follow-up.
 delete from orderly_private.sync_jobs where source_id=s.id and coalesce(lease_until,0)<now_ms;
 perform orderly_private.enqueue(s.id); update orderly_private.sources set status='queued',error=null where id=s.id;
 elsif command='hook_begin' then
 if s.external_id is distinct from input->>'externalId' then perform orderly_private.fail('Webhook source does not match this mapping.',409); end if;
 update orderly_private.sources set webhook_token=input->>'token',webhook_secret=null,webhook_id=null,webhook_expires=now_ms+180000 where id=s.id;
 elsif command='hook_finish' then
 if s.webhook_token is distinct from input->>'token' or s.webhook_secret is distinct from input->>'secret' then perform orderly_private.fail('Webhook handshake failed.',409); end if;
 update orderly_private.sources set webhook_id=input->>'webhookId',webhook_expires=null where id=s.id;
 else perform orderly_private.fail('Unknown integration action.');
 end if;
 return '{}'::jsonb;
end $$;

-- Trusted server/worker only. Single-use OAuth, durable events and fenced leases.
create function public.orderly_sync(command text, input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c orderly_private.connections; s orderly_private.sources; j orderly_private.sync_jobs;
 e orderly_private.external_tasks; state orderly_private.oauth_states; item jsonb; rid text; tid text; result jsonb;
 now_ms bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
begin
 if command='consume_state' then
 delete from orderly_private.oauth_states where hash=input->>'hash' and provider=input->>'provider' and expires>now_ms returning * into state;
 if not found then perform orderly_private.fail('Authorization expired or already used. Connect again.',400); end if;
 if not exists(select 1 from orderly_private.sessions where token=state.session_token and user_id=state.user_id and expires>now_ms) then perform orderly_private.fail('Sign in again before connecting.',401); end if;
 return to_jsonb(state);
 elsif command='hook' then
 select * into s from orderly_private.sources where webhook_token=input->>'token' for update;
 if not found then perform orderly_private.fail('Webhook retired.',410); end if;
 select * into c from orderly_private.connections where id=s.connection_id;
 if c.status<>'connected' then perform orderly_private.fail('Webhook retired.',410); end if;
 if input ? 'secret' then
 if s.webhook_expires<now_ms or s.webhook_expires is null or s.webhook_secret is not null then perform orderly_private.fail('Handshake expired.',403); end if;
 update orderly_private.sources set webhook_secret=input->>'secret' where id=s.id;
 end if;
 return jsonb_build_object('source',s.id,'connection',c.id,'webhookId',s.webhook_id,'secret',coalesce(input->>'secret',s.webhook_secret));
 elsif command='notion_connections' then
 return coalesce((select jsonb_agg(jsonb_build_object('id',id)) from orderly_private.connections where provider='notion' and account_id=input->>'workspace' and status='connected'),'[]'::jsonb);
 elsif command='event' then
 select * into c from orderly_private.connections where id=input->>'connectionId' and status='connected' for update;
 if not found then return '{}'::jsonb; end if;
 insert into orderly_private.sync_events values(c.id,input->>'eventId',now_ms) on conflict do nothing;
 if found then
 for s in select * from orderly_private.sources where connection_id=c.id and (not(input ? 'sourceId') or id=input->>'sourceId') loop
 perform orderly_private.enqueue(s.id); end loop;
 end if;
 return '{}'::jsonb;
 elsif command='claim' then
 -- Lock connection first: serializes token refresh and provider calls per installation.
 select x.* into c from orderly_private.connections x where x.status='connected' and coalesce(x.read_until,0)<=now_ms and exists(
 select 1 from orderly_private.sources y left join orderly_private.sync_jobs z on z.source_id=y.id
 where y.connection_id=x.id and ((z.id is null and y.next_sync<=now_ms and y.status not in ('remap','inaccessible')) or (z.available_at<=now_ms and coalesce(z.lease_until,0)<=now_ms)))
 and not exists(select 1 from orderly_private.sync_jobs z join orderly_private.sources y on y.id=z.source_id where y.connection_id=x.id and z.lease_until>now_ms)
 order by (select min(coalesce(z.available_at,y.next_sync)) from orderly_private.sources y left join orderly_private.sync_jobs z on z.source_id=y.id where y.connection_id=x.id),x.id for update skip locked limit 1;
 if not found then return null; end if;
 for s in select * from orderly_private.sources where connection_id=c.id and next_sync<=now_ms and status not in ('remap','inaccessible') loop
 perform orderly_private.enqueue(s.id,false); end loop;
 select z.* into j from orderly_private.sync_jobs z join orderly_private.sources y on y.id=z.source_id
 where y.connection_id=c.id and z.available_at<=now_ms and coalesce(z.lease_until,0)<=now_ms order by z.available_at,z.id for update of z skip locked limit 1;
 if not found then return null; end if;
 update orderly_private.sync_jobs set lease=input->>'lease',lease_until=now_ms+180000 where id=j.id returning * into j;
 select * into s from orderly_private.sources where id=j.source_id;
 update orderly_private.sources set status='syncing' where id=s.id;
 return jsonb_build_object('job',to_jsonb(j),'source',to_jsonb(s),'connection',to_jsonb(c));
 end if;
 -- Use the same owner -> connection -> source -> job lock order as UI writes.
 select x.* into c from orderly_private.connections x join orderly_private.sources y on y.connection_id=x.id join orderly_private.sync_jobs z on z.source_id=y.id where z.id=input->>'jobId';
 if not found then perform orderly_private.fail('Sync lease retired.',409); end if;
 perform 1 from orderly_private.users where id=c.user_id for update;
 perform 1 from orderly_private.connections where id=c.id for update;
 perform 1 from orderly_private.sources where id=(select source_id from orderly_private.sync_jobs where id=input->>'jobId') for update;
 select * into j from orderly_private.sync_jobs where id=input->>'jobId' for update;
 if not found or j.lease is distinct from input->>'lease' or j.lease_until<=now_ms then perform orderly_private.fail('Sync lease expired.',409); end if;
 select * into s from orderly_private.sources where id=j.source_id for update;
 select * into c from orderly_private.connections where id=s.connection_id for update;
 if c.status<>'connected' or c.generation<>j.connection_generation or s.generation<>j.generation then perform orderly_private.fail('Sync configuration changed.',409); end if;
 if command='credentials' then
 update orderly_private.connections set credentials=input->>'credentials' where id=c.id; return '{}'::jsonb;
 elsif command='fail' then
 update orderly_private.sources set status=input->>'status',error=input->>'error',next_sync=now_ms+900000 where id=s.id;
 if input->>'status'='reconnect' then update orderly_private.connections set status='reconnect',error=input->>'error' where id=c.id; end if;
 if input->>'status' in ('remap','inaccessible','reconnect') or j.attempts>=7 then delete from orderly_private.sync_jobs where id=j.id;
 else update orderly_private.sync_jobs set attempts=attempts+1,available_at=now_ms+greatest((input->>'delay')::bigint,1000),lease=null,lease_until=null where id=j.id; end if;
 return '{}'::jsonb;
 elsif command<>'page' then perform orderly_private.fail('Unknown worker action.'); end if;
 perform 1 from orderly_private.users where id=c.user_id for update;
 for item in select value from jsonb_array_elements(input->'tasks') loop
 select * into e from orderly_private.external_tasks where connection_id=c.id and external_id=item->>'id' for update;
 if not found then
 rid:=gen_random_uuid()::text; tid:=null;
 -- Multi-home Asana tasks stay unassigned until the user chooses explicitly.
 if not coalesce((item->>'ambiguous')::boolean,false) then
 tid:=gen_random_uuid()::text;
 insert into orderly_private.tasks values(tid,c.user_id,s.project_id,left(coalesce(nullif(item->>'name',''),'Untitled task'),200)); end if;
 insert into orderly_private.external_tasks(id,user_id,connection_id,external_id,task_id,metadata) values(rid,c.user_id,c.id,item->>'id',tid,item) returning * into e;
 else
 update orderly_private.external_tasks set metadata=item where id=e.id;
 if e.task_id is not null and not e.explicit_link then
 -- Upstream titles may rename only auto-created tasks. Project/rates never move.
 update orderly_private.tasks set name=left(coalesce(nullif(item->>'name',''),'Untitled task'),200) where id=e.task_id and user_id=c.user_id;
 end if;
 end if;
 insert into orderly_private.source_tasks values(s.id,e.id,c.user_id,j.run_id,true)
 on conflict(source_id,external_task_id) do update set seen_run=excluded.seen_run,available=true;
 end loop;
 if coalesce(input->>'cursor','')<>'' then
 update orderly_private.sync_jobs set cursor=input->>'cursor',available_at=now_ms,lease=null,lease_until=null,attempts=0 where id=j.id;
 else
 update orderly_private.source_tasks set available=false where source_id=s.id and seen_run<>j.run_id;
 update orderly_private.sources set status='synced',error=null,last_success=now_ms,next_sync=now_ms+900000 where id=s.id;
 if j.dirty then update orderly_private.sync_jobs set cursor=null,available_at=now_ms,run_id=gen_random_uuid()::text,dirty=false,lease=null,lease_until=null,attempts=0 where id=j.id;
 else delete from orderly_private.sync_jobs where id=j.id; end if;
 end if;
 return '{}'::jsonb;
end $$;

do $$ declare t text; begin
 foreach t in array array['connections','oauth_states','sources','external_tasks','source_tasks','sync_jobs','sync_events'] loop
 execute format('alter table orderly_private.%I enable row level security',t);
 execute format('revoke all on orderly_private.%I from public,anon,authenticated',t);
 execute format('grant select,insert,update,delete on orderly_private.%I to service_role',t);
 end loop;
end $$;
revoke execute on function orderly_private.enqueue(text,boolean), public.orderly_integrations(text,text,jsonb),public.orderly_sync(text,jsonb) from public,anon,authenticated;
grant execute on function orderly_private.enqueue(text,boolean), public.orderly_integrations(text,text,jsonb),public.orderly_sync(text,jsonb) to service_role;

create or replace function public.orderly_snapshot(owner text) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object(
 'user',(select jsonb_build_object('email',email,'timezone',timezone) from orderly_private.users where id=owner),
 'clients',coalesce((select jsonb_agg(to_jsonb(c) order by id) from orderly_private.clients c where user_id=owner),'[]'::jsonb),
 'projects',coalesce((select jsonb_agg(to_jsonb(p) order by id) from orderly_private.projects p where user_id=owner),'[]'::jsonb),
 'tasks',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('external',coalesce((select jsonb_agg(jsonb_build_object(
   'provider',c.provider,'name',e.metadata->>'name','url',e.metadata->>'url','status',e.metadata->>'status',
   'archived',coalesce((e.metadata->>'archived')::boolean,false),'ambiguous',coalesce((e.metadata->>'ambiguous')::boolean,false),
   'explicit',e.explicit_link,'available',c.status='connected' and exists(select 1 from orderly_private.source_tasks st join orderly_private.sources s on s.id=st.source_id where st.external_task_id=e.id and st.available and s.status<>'inaccessible')))
   from orderly_private.external_tasks e join orderly_private.connections c on c.id=e.connection_id where e.task_id=t.id and e.user_id=owner),'[]'::jsonb)) order by t.id) from orderly_private.tasks t where user_id=owner),'[]'::jsonb),
 'entries',coalesce((select jsonb_agg(to_jsonb(e) order by start desc,id) from orderly_private.entries e where user_id=owner and deleted=0),'[]'::jsonb),
 'audit',coalesce((select jsonb_agg(to_jsonb(a) order by at,id) from orderly_private.audit a where user_id=owner),'[]'::jsonb),
 'now',floor(extract(epoch from clock_timestamp())*1000)::bigint);
$$;
create or replace function orderly_private.start_timer(owner text, task_id jsonb, at_ms bigint) returns text language plpgsql security invoker set search_path='' as $$
declare task jsonb; project jsonb; rid text:=gen_random_uuid()::text;
begin
 task:=orderly_private.owned('tasks',task_id,owner);
 if exists(select 1 from orderly_private.external_tasks e where e.user_id=owner and e.task_id=task->>'id' and not e.explicit_link and coalesce((e.metadata->>'ambiguous')::boolean,false)) then
 perform orderly_private.fail('Choose this imported task billing assignment in Settings before tracking.',409); end if;
 project:=orderly_private.owned('projects',task->'project_id',owner);
 perform orderly_private.interval_check(owner,at_ms,null);
 insert into orderly_private.entries(id,user_id,task_id,start,rate,currency) values(rid,owner,task->>'id',at_ms,(project->>'rate')::bigint,project->>'currency');
 perform orderly_private.log_entry(owner,rid,'start',null,at_ms); return rid;
end $$;

-- Also enforce billing assignment for manual additions/reattribution, without
-- preventing stop, correction or deletion of previously recorded intervals.
create function orderly_private.integration_entry_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' then if new.task_id=old.task_id then return new; end if; end if;
 if exists(select 1 from orderly_private.external_tasks e where e.user_id=new.user_id and e.task_id=new.task_id and not e.explicit_link and coalesce((e.metadata->>'ambiguous')::boolean,false)) then
 perform orderly_private.fail('Choose this imported task billing assignment in Settings before tracking.',409); end if;
 return new;
end $$;
create trigger integration_entry_guard before insert or update of task_id on orderly_private.entries for each row execute function orderly_private.integration_entry_guard();
revoke execute on function orderly_private.integration_entry_guard() from public,anon,authenticated;
grant execute on function orderly_private.integration_entry_guard() to service_role;
