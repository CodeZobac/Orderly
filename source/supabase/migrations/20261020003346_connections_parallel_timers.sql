-- Parallel timers and Notion automation. All changes are transaction compatible.
-- Server-only RPCs continue to use independent Orderly identities.
alter table orderly_private.users add column timer_limit integer default 2 check(timer_limit is null or timer_limit>0);
alter table orderly_private.connections add column identity jsonb not null default '{}';
alter table orderly_private.sources add column baseline_ready boolean not null default false;
alter table orderly_private.sources add column auto_project_name text;
alter table orderly_private.entries add column timer_origin text not null default 'orderly' check(timer_origin in ('orderly','notion'));
drop index orderly_private.one_active_timer;
create unique index one_active_timer_per_task on orderly_private.entries(user_id,task_id) where "end" is null and deleted=0;

create table orderly_private.timer_events (
 id bigint generated always as identity primary key,
 user_id text not null references orderly_private.users(id),
 kind text not null, origin text not null, message text not null,
 entry_id text, at bigint not null, delivered boolean not null default false,
 delivery_token text, delivery_until bigint,
 foreign key(entry_id,user_id) references orderly_private.entries(id,user_id)
);
create index timer_events_owner on orderly_private.timer_events(user_id,id);
create index timer_events_pending on orderly_private.timer_events(user_id,id) where not delivered;
create table orderly_private.notion_timer_state (
 source_id text not null, external_task_id text not null, user_id text not null,
 source_generation integer not null, connection_generation integer not null,
 doing boolean not null, assigned boolean not null,
 primary key(source_id,external_task_id),
 foreign key(source_id,user_id) references orderly_private.sources(id,user_id),
 foreign key(external_task_id,user_id) references orderly_private.external_tasks(id,user_id)
);

create function orderly_private.timer_event(owner text, kind text, origin text, message text, entry_id text default null) returns void
language sql security invoker set search_path='' as $$
 insert into orderly_private.timer_events(user_id,kind,origin,message,entry_id,at,delivered)
 values(owner,kind,origin,message,entry_id,floor(extract(epoch from clock_timestamp())*1000)::bigint,kind='sync');
$$;

-- Lock the owner and validate intervals in a trigger as well as the RPC paths.
-- Different tasks may overlap; an individual task may never overlap itself.
create function orderly_private.parallel_entry_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare cap integer;
begin
 select timer_limit into cap from orderly_private.users where id=new.user_id for update;
 if new.deleted=0 then
 if exists(select 1 from orderly_private.entries e where e.user_id=new.user_id and e.task_id=new.task_id
 and e.id<>new.id and e.deleted=0 and (new."end" is null or e.start<new."end") and (e."end" is null or e."end">new.start)) then
 perform orderly_private.fail('This interval overlaps recorded or running work on this task.',409); end if;
 if new."end" is null and cap is not null then
 if tg_op='INSERT' or old."end" is not null or old.deleted=1 then
 if (select count(*) from orderly_private.entries e where e.user_id=new.user_id and e."end" is null and e.deleted=0 and e.id<>new.id)>=cap then
 perform orderly_private.fail('Timer limit reached. Stop a timer or change the limit in Settings.',409); end if;
 end if; end if; end if;
 return new;
end $$;
create trigger parallel_entry_guard before insert or update on orderly_private.entries for each row execute function orderly_private.parallel_entry_guard();

-- Legacy callers still validate positive intervals; the trigger above owns overlap validation.
create or replace function orderly_private.interval_check(owner text, begin_ms bigint, end_ms bigint, excluded text default '') returns void
language plpgsql security invoker set search_path='' as $$
begin
 if end_ms<=begin_ms then perform orderly_private.fail('End must be after start.'); end if;
end $$;
create or replace function orderly_private.start_timer(owner text, task_id jsonb, at_ms bigint) returns text language plpgsql security invoker set search_path='' as $$
declare task jsonb; project jsonb; rid text:=gen_random_uuid()::text;
begin
 task:=orderly_private.owned('tasks',task_id,owner);
 if exists(select 1 from orderly_private.external_tasks e where e.user_id=owner and e.task_id=task->>'id' and not e.explicit_link and coalesce((e.metadata->>'ambiguous')::boolean,false)) then
 perform orderly_private.fail('Choose this imported task billing assignment in Connections before tracking.',409); end if;
 project:=orderly_private.owned('projects',task->'project_id',owner);
 perform orderly_private.interval_check(owner,at_ms,null);
 insert into orderly_private.entries(id,user_id,task_id,start,rate,currency) values(rid,owner,task->>'id',at_ms,(project->>'rate')::bigint,project->>'currency');
 perform orderly_private.log_entry(owner,rid,'start',null,at_ms); return rid;
end $$;
create or replace function orderly_private.finish_timer(owner text, entry jsonb, at_ms bigint) returns void language plpgsql security invoker set search_path='' as $$
begin
 if at_ms<=(entry->>'start')::bigint then perform orderly_private.fail('Wait a moment before stopping.'); end if;
 perform orderly_private.interval_check(owner,(entry->>'start')::bigint,at_ms,entry->>'id');
 update orderly_private.entries set "end"=at_ms,version=version+1 where id=entry->>'id' and user_id=owner;
 perform orderly_private.log_entry(owner,entry->>'id','stop',entry,at_ms);
end $$;
create or replace function public.orderly_mutate(owner text, input jsonb, at_ms bigint) returns jsonb language plpgsql security invoker set search_path='' as $$
declare request_key text; prior orderly_private.requests; result jsonb:='{"ok":true}'; record jsonb; task jsonb; project jsonb; rid text; currency_code text; begin_ms bigint; end_ms bigint; notes_text text; rate_cents bigint; action text:=input->>'action';
begin
 -- Serialize capacity, retries, and notifications across UI and worker writes.
 perform 1 from orderly_private.users where id=owner for update;
 if not found then perform orderly_private.fail('Record not found.',404); end if;
 request_key:=orderly_private.label(input->'key','Request key',100);
 select * into prior from orderly_private.requests where user_id=owner and key=request_key;
 if found then
 if prior.payload<>input then perform orderly_private.fail('Request key already used for another action.',409); end if;
 return prior.result; end if;
 case action
 when 'client' then insert into orderly_private.clients values(gen_random_uuid()::text,owner,orderly_private.label(input->'name','Client name'));
 when 'project' then
 perform orderly_private.owned('clients',input->'clientId',owner);
 currency_code:=orderly_private.label(input->'currency','Currency');
 if currency_code !~ '^[A-Z]{3}$' then perform orderly_private.fail('Use a three-letter currency code.'); end if;
 rate_cents:=orderly_private.rate(input->'rate'); rid:=gen_random_uuid()::text;
 insert into orderly_private.projects values(rid,owner,input->>'clientId',orderly_private.label(input->'name','Project name'),currency_code,rate_cents);
 insert into orderly_private.project_rates values(gen_random_uuid()::text,owner,rid,rate_cents,at_ms);
 when 'rate' then
 perform orderly_private.owned('projects',input->'projectId',owner); rate_cents:=orderly_private.rate(input->'rate');
 update orderly_private.projects set rate=rate_cents where id=input->>'projectId' and user_id=owner;
 insert into orderly_private.project_rates values(gen_random_uuid()::text,owner,input->>'projectId',rate_cents,at_ms);
 when 'task' then
 perform orderly_private.owned('projects',input->'projectId',owner);
 insert into orderly_private.tasks values(gen_random_uuid()::text,owner,input->>'projectId',orderly_private.label(input->'name','Task name'));
 when 'start' then
 result:=jsonb_build_object('id',orderly_private.start_timer(owner,input->'taskId',at_ms));
 when 'stop' then
 record:=orderly_private.owned('entries',input->'entryId',owner);
 if (record->>'deleted')::integer=1 then perform orderly_private.fail('Record not found.',404); end if;
 if record->>'end' is null then perform orderly_private.finish_timer(owner,record,at_ms); end if;
 when 'switch' then
 select to_jsonb(e) into record from orderly_private.entries e where user_id=owner and id=input->>'entryId' and "end" is null and deleted=0;
 if record is null or record->>'id' is distinct from input->>'entryId' then perform orderly_private.fail('The active timer changed. Refresh and try again.',409); end if;
 perform orderly_private.owned('tasks',input->'taskId',owner);
 perform orderly_private.finish_timer(owner,record,at_ms);
 result:=jsonb_build_object('id',orderly_private.start_timer(owner,input->'taskId',at_ms));
 when 'manual','edit','delete','restore' then
 if action<>'manual' then
 record:=orderly_private.owned('entries',input->'entryId',owner);
 if record->>'end' is null then perform orderly_private.fail('Stop the timer before correcting it.'); end if;
 if jsonb_typeof(input->'version') is distinct from 'number' or input->'version'<>record->'version' then perform orderly_private.fail('This entry changed in another tab. Refresh and try again.',409); end if;
 rid:=record->>'id';
 end if;
 if action='delete' then update orderly_private.entries set deleted=1,version=version+1 where id=rid and user_id=owner;
 elsif action='restore' then
 perform orderly_private.interval_check(owner,(record->>'start')::bigint,(record->>'end')::bigint,rid);
 update orderly_private.entries set deleted=0,version=version+1 where id=rid and user_id=owner;
 else
 if action='edit' and (record->>'deleted')::integer=1 then perform orderly_private.fail('Record not found.',404); end if;
 task:=orderly_private.owned('tasks',input->'taskId',owner); project:=orderly_private.owned('projects',task->'project_id',owner);
 begin_ms:=orderly_private.instant(input->'start',floor(extract(epoch from clock_timestamp())*1000)::bigint);
 end_ms:=orderly_private.instant(input->'end',floor(extract(epoch from clock_timestamp())*1000)::bigint);
 perform orderly_private.interval_check(owner,begin_ms,end_ms,coalesce(rid,''));
 if jsonb_typeof(input->'billable') is distinct from 'boolean' then perform orderly_private.fail('Choose billability.'); end if;
 notes_text:=coalesce(input->>'notes','');
 if (input ? 'notes' and jsonb_typeof(input->'notes') is distinct from 'string') or length(notes_text)>2000 then perform orderly_private.fail('Keep notes under 2000 characters.'); end if;
 if action='manual' then
 rid:=gen_random_uuid()::text;
 insert into orderly_private.entries(id,user_id,task_id,start,"end",rate,currency,billable,notes) values(rid,owner,task->>'id',begin_ms,end_ms,(project->>'rate')::bigint,project->>'currency',case when (input->>'billable')::boolean then 1 else 0 end,notes_text);
 else
 update orderly_private.entries set task_id=task->>'id',start=begin_ms,"end"=end_ms,billable=case when (input->>'billable')::boolean then 1 else 0 end,notes=notes_text,rate=case when task->>'id'=record->>'task_id' then (record->>'rate')::bigint else (project->>'rate')::bigint end,currency=case when task->>'id'=record->>'task_id' then record->>'currency' else project->>'currency' end,version=version+1 where id=rid and user_id=owner;
 end if;
 end if;
 perform orderly_private.log_entry(owner,rid,action,record,at_ms);
 when 'timer_preferences' then
 if not(input ? 'timerLimit') or (input->'timerLimit'<>'null'::jsonb and
 (jsonb_typeof(input->'timerLimit')<>'number' or (input->>'timerLimit')::numeric<>trunc((input->>'timerLimit')::numeric)
 or (input->>'timerLimit')::numeric<1 or (input->>'timerLimit')::numeric>2147483647)) then
 perform orderly_private.fail('Choose a positive whole-number timer limit or No limit.'); end if;
 update orderly_private.users set timer_limit=(input->>'timerLimit')::integer where id=owner;
 when 'timezone' then
 notes_text:=orderly_private.label(input->'timezone','Timezone');
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=notes_text) then perform orderly_private.fail('Choose a valid IANA timezone.'); end if;
 update orderly_private.users set timezone=notes_text where id=owner;
 else perform orderly_private.fail('Unknown action.');
 end case;
 if action in ('start','switch') then
 perform orderly_private.timer_event(owner,'start','orderly','Timer started: '||(select name from orderly_private.tasks where id=input->>'taskId' and user_id=owner),result->>'id');
 end if;
 if action in ('stop','switch') and record->>'end' is null then
 perform orderly_private.timer_event(owner,'stop','orderly','Timer stopped: '||(select name from orderly_private.tasks where id=record->>'task_id' and user_id=owner),record->>'id');
 end if;
 if action in ('manual','edit','delete','restore') then
 perform orderly_private.timer_event(owner,action,'orderly','Time entry '||case action when 'manual' then 'added' when 'edit' then 'updated' when 'delete' then 'deleted' else 'restored' end||'.',rid);
 end if;
 if action='timer_preferences' then perform orderly_private.timer_event(owner,'sync','orderly','Timer preferences updated.'); end if;
 insert into orderly_private.requests values(owner,request_key,input,result); return result;
end $$;
create or replace function public.orderly_snapshot(owner text) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object(
 'user',(select jsonb_build_object('email',email,'timezone',timezone,'timer_limit',timer_limit) from orderly_private.users where id=owner),
 'clients',coalesce((select jsonb_agg(to_jsonb(c) order by id) from orderly_private.clients c where user_id=owner),'[]'::jsonb),
 'projects',coalesce((select jsonb_agg(to_jsonb(p) order by id) from orderly_private.projects p where user_id=owner),'[]'::jsonb),
 'tasks',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('external',coalesce((select jsonb_agg(jsonb_build_object(
   'provider',c.provider,'name',e.metadata->>'name','url',e.metadata->>'url','status',e.metadata->>'status','assignee',e.metadata->>'assignee',
   'archived',coalesce((e.metadata->>'archived')::boolean,false),'ambiguous',coalesce((e.metadata->>'ambiguous')::boolean,false),
   'explicit',e.explicit_link,'available',c.status='connected' and exists(select 1 from orderly_private.source_tasks st join orderly_private.sources s on s.id=st.source_id where st.external_task_id=e.id and st.available and s.status<>'inaccessible')))
   from orderly_private.external_tasks e join orderly_private.connections c on c.id=e.connection_id where e.task_id=t.id and e.user_id=owner),'[]'::jsonb)) order by t.id) from orderly_private.tasks t where user_id=owner),'[]'::jsonb),
 'entries',coalesce((select jsonb_agg(to_jsonb(e) order by start desc,id) from orderly_private.entries e where user_id=owner and deleted=0),'[]'::jsonb),
 'audit',coalesce((select jsonb_agg(to_jsonb(a) order by at,id) from orderly_private.audit a where user_id=owner),'[]'::jsonb),
 'now',floor(extract(epoch from clock_timestamp())*1000)::bigint);
$$;

-- Cursor refresh and leased notification claims. Tabs share a durable claim;
-- an interrupted response is recoverable after its lease expires.
create function public.orderly_timer_events(owner text, command text, input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; now_ms bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
begin
 perform 1 from orderly_private.users where id=owner for update;
 if not found then perform orderly_private.fail('Sign in to continue.',401); end if;
 if command='list' then
 return jsonb_build_object('cursor',coalesce((select max(id)::text from orderly_private.timer_events where user_id=owner),'0'),
 'changed',exists(select 1 from orderly_private.timer_events where user_id=owner and id>coalesce((input->>'cursor')::bigint,0)),
 'pending',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('id',e.id::text)) from (select * from orderly_private.timer_events where user_id=owner and not delivered order by id limit 100) e),'[]'::jsonb));
 elsif command='claim' then
 with claimed as (update orderly_private.timer_events set delivery_token=input->>'token',delivery_until=now_ms+30000 where user_id=owner and not delivered
 and (delivery_until is null or delivery_until<=now_ms or delivery_token=input->>'token')
 and id::text in (select jsonb_array_elements_text(input->'ids')) returning *)
 select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('id',c.id::text) order by c.id),'[]'::jsonb) into result from claimed c;
 return result;
 elsif command='ack' then
 update orderly_private.timer_events set delivered=true,delivery_token=null,delivery_until=null
 where user_id=owner and not delivered and delivery_token=input->>'token'
 and id::text in (select jsonb_array_elements_text(input->'ids'));
 return '{}'::jsonb;
 end if;
 perform orderly_private.fail('Unknown timer event action.'); return null;
end $$;

-- Stable identity and auto-created projects wrap the existing connection logic.
alter function public.orderly_integrations(text,text,jsonb) rename to orderly_integrations_base;
create function public.orderly_integrations(owner text, command text, input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; c orderly_private.connections; s orderly_private.sources; project text; client text; auto_name text;
begin
 perform 1 from orderly_private.users where id=owner for update;
 if not found then perform orderly_private.fail('Sign in to continue.',401); end if;
 if command='map' then
 select * into c from orderly_private.connections where id=input->>'connectionId' and user_id=owner for update;
 if not found or c.status<>'connected' then perform orderly_private.fail('Reconnect this provider first.',409); end if;
 select * into s from orderly_private.sources where connection_id=c.id and external_id=input->>'externalId' for update;
 if c.provider='notion' and coalesce((input->'mapping'->>'automation')::boolean,false) and coalesce(c.identity->>'user_id','')='' then
 perform orderly_private.fail('Reconnect Notion to identify your account before enabling timers.',409); end if;
 if c.provider='notion' and coalesce(input->>'projectId','')='' then
 if s.id is not null then project:=s.project_id; auto_name:=s.auto_project_name;
 else
 -- A deterministic connection client avoids duplicate clients and title merging.
 client:='notion-'||c.id;
 insert into orderly_private.clients(id,user_id,name) values(client,owner,left(c.label,200)) on conflict(id) do nothing;
 project:=gen_random_uuid()::text; auto_name:=left(input->>'name',200);
 insert into orderly_private.projects(id,user_id,client_id,name,currency,rate) values(project,owner,client,auto_name,'EUR',0);
 insert into orderly_private.project_rates values(gen_random_uuid()::text,owner,project,0,floor(extract(epoch from clock_timestamp())*1000)::bigint);
 end if;
 input:=input||jsonb_build_object('projectId',project);
 elsif s.id is not null and s.project_id=input->>'projectId' then auto_name:=s.auto_project_name;
 end if;
 result:=public.orderly_integrations_base(owner,command,input);
 update orderly_private.sources set baseline_ready=false,auto_project_name=auto_name where id=result#>>'{}';
 return result;
 end if;
 result:=public.orderly_integrations_base(owner,command,input);
 if command='connect' then
 update orderly_private.connections set identity=coalesce(input->'identity','{}'::jsonb) where id=result#>>'{}';
 update orderly_private.sources set baseline_ready=false where connection_id=result#>>'{}';
 elsif command='disconnect' then
 update orderly_private.sources set baseline_ready=false where connection_id=input->>'connectionId' and user_id=owner;
 perform orderly_private.timer_event(owner,'connection','orderly','Connection disconnected. Existing timers remain available to stop manually.');
 end if;
 return result;
end $$;

-- Called only from a validated, fenced worker page transaction while the owner
-- row is locked. Status observations, starts/stops, and events commit together.
create function orderly_private.observe_notion_timer(s orderly_private.sources, c orderly_private.connections, e orderly_private.external_tasks, item jsonb, at_ms bigint) returns void
language plpgsql security invoker set search_path='' as $$
declare prior orderly_private.notion_timer_state; is_doing boolean; is_assigned boolean; entry jsonb; rid text; cap integer;
begin
 if c.provider<>'notion' or not coalesce((s.mapping->>'automation')::boolean,false) or coalesce(c.identity->>'user_id','')='' then return; end if;
 is_doing:=coalesce((s.mapping->'doing') ? (item->>'status_id'),false) and not coalesce((item->>'archived')::boolean,false);
 is_assigned:=coalesce((item->'assignee_ids') ? (c.identity->>'user_id'),false);
 select * into prior from orderly_private.notion_timer_state where source_id=s.id and external_task_id=e.id for update;
 if found and prior.source_generation=s.generation and prior.connection_generation=c.generation and s.baseline_ready and e.task_id is not null then
 select to_jsonb(t) into entry from orderly_private.entries t where user_id=c.user_id and task_id=e.task_id and "end" is null and deleted=0;
 if entry is not null and ((prior.doing and not is_doing and (prior.assigned or is_assigned)) or (prior.assigned and not is_assigned and entry->>'timer_origin'='notion')) then
 perform orderly_private.finish_timer(c.user_id,entry,greatest(at_ms,(entry->>'start')::bigint+1));
 perform orderly_private.timer_event(c.user_id,'stop','notion','Notion stopped timer: '||coalesce(item->>'name','Task'),entry->>'id');
 elsif not prior.doing and is_doing and is_assigned and entry is null then
 select timer_limit into cap from orderly_private.users where id=c.user_id;
 if cap is not null and (select count(*) from orderly_private.entries where user_id=c.user_id and "end" is null and deleted=0)>=cap then
 perform orderly_private.timer_event(c.user_id,'blocked','notion','Timer limit reached: '||coalesce(item->>'name','Task')||' was not started. Start it manually or move it out of Doing and back.');
 else
 rid:=orderly_private.start_timer(c.user_id,to_jsonb(e.task_id),at_ms);
 update orderly_private.entries set timer_origin='notion' where id=rid;
 perform orderly_private.timer_event(c.user_id,'start','notion','Notion started timer: '||coalesce(item->>'name','Task'),rid);
 end if;
 end if;
 end if;
 insert into orderly_private.notion_timer_state values(s.id,e.id,c.user_id,s.generation,c.generation,is_doing,is_assigned)
 on conflict(source_id,external_task_id) do update set source_generation=excluded.source_generation,connection_generation=excluded.connection_generation,doing=excluded.doing,assigned=excluded.assigned;
end $$;
create or replace function public.orderly_board_sync(command text, input jsonb default '{}') returns jsonb
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
 update orderly_private.sources set status=input->>'status',error=input->>'error',next_sync=now_ms+900000,
 baseline_ready=case when input->>'status' in ('remap','inaccessible','reconnect') then false else baseline_ready end where id=s.id;
 if input->>'status' in ('remap','inaccessible','reconnect') then
 perform orderly_private.timer_event(c.user_id,'connection',c.provider,s.name||': '||(input->>'error')||' Existing timers can be stopped manually.'); end if;
 if input->>'status'='reconnect' then update orderly_private.connections set status='reconnect',error=input->>'error' where id=c.id; end if;
 if input->>'status' in ('remap','inaccessible','reconnect') or j.attempts>=7 then delete from orderly_private.sync_jobs where id=j.id;
 else update orderly_private.sync_jobs set attempts=attempts+1,available_at=now_ms+greatest((input->>'delay')::bigint,1000),lease=null,lease_until=null where id=j.id; end if;
 return '{}'::jsonb;
 elsif command<>'page' then perform orderly_private.fail('Unknown worker action.'); end if;
 perform 1 from orderly_private.users where id=c.user_id for update;
 if c.provider='notion' and coalesce(input->>'sourceName','')<>'' then
 if s.auto_project_name is not null then
 update orderly_private.projects set name=left(input->>'sourceName',200) where id=s.project_id and user_id=c.user_id and name=s.auto_project_name;
 update orderly_private.sources set auto_project_name=left(input->>'sourceName',200) where id=s.id; end if;
 update orderly_private.sources set name=left(input->>'sourceName',200) where id=s.id;
 end if;
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
 -- Provider updates can arrive late. Older page content cannot roll metadata
 -- or automation backwards, but still confirms source membership in this scan.
 if c.provider='notion' and coalesce(item->>'updated_at','')<>'' and coalesce(e.metadata->>'updated_at','')<>''
 and (item->>'updated_at')::timestamptz < (e.metadata->>'updated_at')::timestamptz then
 insert into orderly_private.source_tasks values(s.id,e.id,c.user_id,j.run_id,true)
 on conflict(source_id,external_task_id) do update set seen_run=excluded.seen_run,available=true;
 continue;
 end if;
 update orderly_private.external_tasks set metadata=item where id=e.id;
 if e.task_id is not null and not e.explicit_link then
 -- Upstream titles may rename only auto-created tasks. Project/rates never move.
 update orderly_private.tasks set name=left(coalesce(nullif(item->>'name',''),'Untitled task'),200) where id=e.task_id and user_id=c.user_id;
 end if;
 end if;
 insert into orderly_private.source_tasks values(s.id,e.id,c.user_id,j.run_id,true)
 on conflict(source_id,external_task_id) do update set seen_run=excluded.seen_run,available=true;
 perform orderly_private.observe_notion_timer(s,c,e,item,now_ms);
 end loop;
 perform orderly_private.timer_event(c.user_id,'sync','notion','Task data synchronized.');
 if coalesce(input->>'cursor','')<>'' then
 update orderly_private.sync_jobs set cursor=input->>'cursor',available_at=now_ms,lease=null,lease_until=null,attempts=0 where id=j.id;
 else
 update orderly_private.source_tasks set available=false where source_id=s.id and seen_run<>j.run_id;
 update orderly_private.sources set baseline_ready=true,status='synced',error=null,last_success=now_ms,next_sync=now_ms+900000 where id=s.id;
 if j.dirty then update orderly_private.sync_jobs set cursor=null,available_at=now_ms,run_id=gen_random_uuid()::text,dirty=false,lease=null,lease_until=null,attempts=0 where id=j.id;
 else delete from orderly_private.sync_jobs where id=j.id; end if;
 end if;
 return '{}'::jsonb;
end $$;

-- New private objects use the same service-role-only ownership boundary.
alter table orderly_private.timer_events enable row level security;
alter table orderly_private.notion_timer_state enable row level security;
revoke all on orderly_private.timer_events,orderly_private.notion_timer_state from public,anon,authenticated;
grant select,insert,update,delete on orderly_private.timer_events,orderly_private.notion_timer_state to service_role;
revoke all on sequence orderly_private.timer_events_id_seq from public,anon,authenticated;
grant usage,select on sequence orderly_private.timer_events_id_seq to service_role;
revoke execute on all functions in schema orderly_private from public,anon,authenticated;
grant execute on all functions in schema orderly_private to service_role;
revoke execute on function public.orderly_timer_events(text,text,jsonb),public.orderly_integrations(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.orderly_timer_events(text,text,jsonb),public.orderly_integrations(text,text,jsonb) to service_role;

-- Preserve legacy SQLite import defaults after adding timer columns.
create or replace function public.orderly_import(data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare kind text; rows_json jsonb;
begin
 lock table orderly_private.users in access exclusive mode;
 if exists(select 1 from orderly_private.users) then perform orderly_private.fail('Import requires an empty Orderly database.',409); end if;
 foreach kind in array array['users','sessions','auth_attempts','clients','projects','tasks','entries','audit','project_rates'] loop
 rows_json:=coalesce(data->kind,'[]'::jsonb);
 if kind='users' then
 select coalesce(jsonb_agg(jsonb_build_object('timer_limit',2)||value),'[]'::jsonb) into rows_json from jsonb_array_elements(rows_json);
 elsif kind='entries' then
 select coalesce(jsonb_agg(jsonb_build_object('timer_origin','orderly')||value),'[]'::jsonb) into rows_json from jsonb_array_elements(rows_json);
 end if;
 execute format('insert into orderly_private.%I select * from jsonb_populate_recordset(null::orderly_private.%I,$1)',kind,kind) using rows_json;
 end loop;
 insert into orderly_private.requests select user_id,key,payload::jsonb,result::jsonb from jsonb_to_recordset(coalesce(data->'requests','[]'::jsonb)) as r(user_id text,key text,payload text,result text);
 return jsonb_build_object('users',(select count(*) from orderly_private.users),'entries',(select count(*) from orderly_private.entries));
end $$;
