-- Orderly identities are independent of auth.users. Only the trusted Next server
-- can execute these invoker RPCs; anon/authenticated have no access.
create schema orderly_private;
revoke all on schema orderly_private from public, anon, authenticated;
create table orderly_private.users (id text primary key, email text unique not null, password text not null, timezone text not null default 'UTC');
create table orderly_private.sessions (token text primary key, user_id text not null references orderly_private.users(id), expires bigint not null);
create index sessions_owner on orderly_private.sessions(user_id);
create index sessions_expiry on orderly_private.sessions(expires);
create table orderly_private.auth_attempts (email text primary key, attempts integer not null, reset_at bigint not null);
create table orderly_private.clients (id text primary key, user_id text not null references orderly_private.users(id), name text not null, unique(id,user_id));
create table orderly_private.projects (id text primary key, user_id text not null references orderly_private.users(id), client_id text not null, name text not null, currency text not null check(currency ~ '^[A-Z]{3}$'), rate bigint not null check(rate>=0), unique(id,user_id), foreign key(client_id,user_id) references orderly_private.clients(id,user_id));
create table orderly_private.tasks (id text primary key, user_id text not null references orderly_private.users(id), project_id text not null, name text not null, unique(id,user_id), foreign key(project_id,user_id) references orderly_private.projects(id,user_id));
create table orderly_private.entries (id text primary key, user_id text not null references orderly_private.users(id), task_id text not null, start bigint not null check(start>=0), "end" bigint, rate bigint not null check(rate>=0), currency text not null, billable integer not null default 1 check(billable in (0,1)), notes text not null default '', deleted integer not null default 0 check(deleted in (0,1)), version integer not null default 1 check(version>0), unique(id,user_id), foreign key(task_id,user_id) references orderly_private.tasks(id,user_id), check("end" is null or "end">start));
create unique index one_active_timer on orderly_private.entries(user_id) where "end" is null and deleted=0;
create index entry_intervals on orderly_private.entries(user_id,start,"end") where deleted=0;
create table orderly_private.audit (id text primary key, user_id text not null references orderly_private.users(id), entry_id text not null, action text not null, before_json text, after_json text, at bigint not null, foreign key(entry_id,user_id) references orderly_private.entries(id,user_id));
create index audit_owner on orderly_private.audit(user_id,at);
create table orderly_private.requests (user_id text not null references orderly_private.users(id), key text not null, payload jsonb not null, result jsonb not null, primary key(user_id,key));
create table orderly_private.project_rates (id text primary key, user_id text not null references orderly_private.users(id), project_id text not null, rate bigint not null check(rate>=0), at bigint not null, foreign key(project_id,user_id) references orderly_private.projects(id,user_id));
create index project_rates_owner on orderly_private.project_rates(user_id,project_id,at);
create index clients_owner on orderly_private.clients(user_id);
create index projects_client on orderly_private.projects(user_id,client_id);
create index tasks_project on orderly_private.tasks(user_id,project_id);
create index entries_task on orderly_private.entries(user_id,task_id);

create function orderly_private.fail(message text, status integer default 400) returns void language plpgsql security invoker set search_path='' as $$
begin raise exception 'ORDERLY:%:%', status,message; end $$;
create function orderly_private.label(value jsonb, name text, max_length integer default 200) returns text language plpgsql security invoker set search_path='' as $$
begin
 if jsonb_typeof(value) is distinct from 'string' or btrim(value#>>'{}')='' or length(value#>>'{}')>max_length then
 perform orderly_private.fail(name||' is required (up to '||max_length||' characters).'); end if;
 return btrim(value#>>'{}');
end $$;
create function orderly_private.rate(value jsonb) returns bigint language plpgsql security invoker set search_path='' as $$
begin
 if jsonb_typeof(value) is distinct from 'string' or (value#>>'{}') !~ '^\d{1,7}(\.\d{1,2})?$' then
 perform orderly_private.fail('Enter a non-negative hourly rate with at most two decimals.'); end if;
 return ((value#>>'{}')::numeric*100)::bigint;
end $$;
create function orderly_private.instant(value jsonb, now_ms bigint) returns bigint language plpgsql security invoker set search_path='' as $$
begin
 if jsonb_typeof(value) is distinct from 'number' or (value#>>'{}')::numeric<>trunc((value#>>'{}')::numeric) or (value#>>'{}')::numeric<0 or (value#>>'{}')::numeric>least(9007199254740991,now_ms+60000) then
 perform orderly_private.fail('Use a valid timestamp, no later than now.'); end if;
 return (value#>>'{}')::bigint;
end $$;
create function orderly_private.owned(kind text, record_id jsonb, owner text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; rid text;
begin
 if kind not in ('clients','projects','tasks','entries') then perform orderly_private.fail('Unknown record.'); end if;
 rid:=orderly_private.label(record_id,'Record ID');
 execute format('select to_jsonb(t) from orderly_private.%I t where id=$1 and user_id=$2',kind) into result using rid,owner;
 if result is null then perform orderly_private.fail('Record not found.',404); end if;
 return result;
end $$;
create function orderly_private.interval_check(owner text, begin_ms bigint, end_ms bigint, excluded text default '') returns void language plpgsql security invoker set search_path='' as $$
begin
 if end_ms<=begin_ms then perform orderly_private.fail('End must be after start.'); end if;
 if exists(select 1 from orderly_private.entries e where e.user_id=owner and deleted=0 and id<>excluded and (end_ms is null or start<end_ms) and ("end" is null or "end">begin_ms)) then
 perform orderly_private.fail('This interval overlaps recorded or running work.',409); end if;
end $$;
create function orderly_private.log_entry(owner text, entry text, action text, before_row jsonb, at_ms bigint) returns void language sql security invoker set search_path='' as $$
 insert into orderly_private.audit values (gen_random_uuid()::text,owner,entry,action,before_row::text,(select to_jsonb(e)::text from orderly_private.entries e where e.id=entry and e.user_id=owner),at_ms);
$$;
create function orderly_private.start_timer(owner text, task_id jsonb, at_ms bigint) returns text language plpgsql security invoker set search_path='' as $$
declare task jsonb; project jsonb; rid text:=gen_random_uuid()::text;
begin
 task:=orderly_private.owned('tasks',task_id,owner);
 project:=orderly_private.owned('projects',task->'project_id',owner);
 perform orderly_private.interval_check(owner,at_ms,null);
 insert into orderly_private.entries(id,user_id,task_id,start,rate,currency) values(rid,owner,task->>'id',at_ms,(project->>'rate')::bigint,project->>'currency');
 perform orderly_private.log_entry(owner,rid,'start',null,at_ms); return rid;
end $$;
create function orderly_private.finish_timer(owner text, entry jsonb, at_ms bigint) returns void language plpgsql security invoker set search_path='' as $$
begin
 if at_ms<=(entry->>'start')::bigint then perform orderly_private.fail('Wait a moment before stopping.'); end if;
 perform orderly_private.interval_check(owner,(entry->>'start')::bigint,at_ms,entry->>'id');
 update orderly_private.entries set "end"=at_ms,version=version+1 where id=entry->>'id' and user_id=owner;
 perform orderly_private.log_entry(owner,entry->>'id','stop',entry,at_ms);
end $$;

create function public.orderly_auth(command text, input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior orderly_private.auth_attempts; result jsonb; owner_id text;
begin
 case command
 when 'attempt' then
 insert into orderly_private.auth_attempts values(input->>'email',0,(input->>'now')::bigint+900000) on conflict(email) do nothing;
 select * into prior from orderly_private.auth_attempts where email=input->>'email' for update;
 if prior.reset_at>(input->>'now')::bigint and prior.attempts>=10 then perform orderly_private.fail('Too many attempts. Try again in 15 minutes.',429); end if;
 update orderly_private.auth_attempts set attempts=case when prior.reset_at>(input->>'now')::bigint then prior.attempts+1 else 1 end,reset_at=case when prior.reset_at>(input->>'now')::bigint then prior.reset_at else (input->>'now')::bigint+900000 end where email=input->>'email';
 when 'credential' then
 select jsonb_build_object('id',id,'password',password) into result from orderly_private.users where email=input->>'email'; return result;
 when 'register' then
 begin
 insert into orderly_private.users(id,email,password) values(input->>'id',input->>'email',input->>'password');
 exception when unique_violation then perform orderly_private.fail('Unable to create this account. Try signing in.',409); end;
 insert into orderly_private.sessions values(input->>'token',input->>'id',(input->>'expires')::bigint);
 delete from orderly_private.auth_attempts where email=input->>'email';
 when 'login' then
 perform 1 from orderly_private.users where id=input->>'id' and email=input->>'email' for update;
 if not found then perform orderly_private.fail('Email or password is incorrect.',401); end if;
 insert into orderly_private.sessions values(input->>'token',input->>'id',(input->>'expires')::bigint);
 delete from orderly_private.auth_attempts where email=input->>'email';
 when 'session' then
 select user_id into owner_id from orderly_private.sessions where token=input->>'token' and expires>(input->>'now')::bigint;
 if owner_id is null then perform orderly_private.fail('Your session expired. Sign in again.',401); end if;
 return to_jsonb(owner_id);
 when 'logout' then delete from orderly_private.sessions where token=input->>'token';
 else perform orderly_private.fail('Unknown authentication action.');
 end case;
 return '{"ok":true}'::jsonb;
end $$;
create function public.orderly_snapshot(owner text) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object(
 'user',(select jsonb_build_object('email',email,'timezone',timezone) from orderly_private.users where id=owner),
 'clients',coalesce((select jsonb_agg(to_jsonb(c) order by id) from orderly_private.clients c where user_id=owner),'[]'::jsonb),
 'projects',coalesce((select jsonb_agg(to_jsonb(p) order by id) from orderly_private.projects p where user_id=owner),'[]'::jsonb),
 'tasks',coalesce((select jsonb_agg(to_jsonb(t) order by id) from orderly_private.tasks t where user_id=owner),'[]'::jsonb),
 'entries',coalesce((select jsonb_agg(to_jsonb(e) order by start desc,id) from orderly_private.entries e where user_id=owner and deleted=0),'[]'::jsonb),
 'audit',coalesce((select jsonb_agg(to_jsonb(a) order by at,id) from orderly_private.audit a where user_id=owner),'[]'::jsonb),
 'now',floor(extract(epoch from clock_timestamp())*1000)::bigint);
$$;
create function public.orderly_mutate(owner text, input jsonb, at_ms bigint) returns jsonb language plpgsql security invoker set search_path='' as $$
declare request_key text; prior orderly_private.requests; result jsonb:='{"ok":true}'; record jsonb; task jsonb; project jsonb; rid text; currency_code text; begin_ms bigint; end_ms bigint; notes_text text; rate_cents bigint; action text:=input->>'action';
begin
 -- Serialize all mutations for an owner across processes before checking intervals
 -- and retry keys. The unique active-timer index remains a second line of defense.
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
 if exists(select 1 from orderly_private.entries where user_id=owner and "end" is null and deleted=0) then perform orderly_private.fail('A timer is already running. Stop it or explicitly switch tasks.',409); end if;
 result:=jsonb_build_object('id',orderly_private.start_timer(owner,input->'taskId',at_ms));
 when 'stop' then
 record:=orderly_private.owned('entries',input->'entryId',owner);
 if (record->>'deleted')::integer=1 then perform orderly_private.fail('Record not found.',404); end if;
 if record->>'end' is null then perform orderly_private.finish_timer(owner,record,at_ms); end if;
 when 'switch' then
 select to_jsonb(e) into record from orderly_private.entries e where user_id=owner and "end" is null and deleted=0;
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
 when 'timezone' then
 notes_text:=orderly_private.label(input->'timezone','Timezone');
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=notes_text) then perform orderly_private.fail('Choose a valid IANA timezone.'); end if;
 update orderly_private.users set timezone=notes_text where id=owner;
 else perform orderly_private.fail('Unknown action.');
 end case;
 insert into orderly_private.requests values(owner,request_key,input,result); return result;
end $$;

-- Explicit grants account for projects that do not auto-expose new API objects.
do $$ declare t record; begin
 for t in select tablename from pg_catalog.pg_tables where schemaname='orderly_private' loop
 execute format('alter table orderly_private.%I enable row level security',t.tablename);
 end loop;
end $$;
revoke all on all tables in schema orderly_private from public,anon,authenticated;
revoke execute on all functions in schema orderly_private from public,anon,authenticated;
revoke execute on function public.orderly_auth(text,jsonb),public.orderly_snapshot(text),public.orderly_mutate(text,jsonb,bigint) from public,anon,authenticated;
grant usage on schema public,orderly_private to service_role;
grant select,insert,update,delete on all tables in schema orderly_private to service_role;
grant execute on all functions in schema orderly_private to service_role;
grant execute on function public.orderly_auth(text,jsonb),public.orderly_snapshot(text),public.orderly_mutate(text,jsonb,bigint) to service_role;

-- Explicit one-time import: only into an empty Orderly database. Existing SQLite
-- files remain untouched. Row locks prevent registration/mutations during import.
create function public.orderly_import(data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare kind text; rows_json jsonb;
begin
 lock table orderly_private.users in access exclusive mode;
 if exists(select 1 from orderly_private.users) then perform orderly_private.fail('Import requires an empty Orderly database.',409); end if;
 foreach kind in array array['users','sessions','auth_attempts','clients','projects','tasks','entries','audit','project_rates'] loop
 rows_json:=coalesce(data->kind,'[]'::jsonb);
 execute format('insert into orderly_private.%I select * from jsonb_populate_recordset(null::orderly_private.%I,$1)',kind,kind) using rows_json;
 end loop;
 insert into orderly_private.requests select user_id,key,payload::jsonb,result::jsonb from jsonb_to_recordset(coalesce(data->'requests','[]'::jsonb)) as r(user_id text,key text,payload text,result text);
 return jsonb_build_object('users',(select count(*) from orderly_private.users),'entries',(select count(*) from orderly_private.entries));
end $$;
revoke execute on function public.orderly_import(jsonb) from public,anon,authenticated;
grant execute on function public.orderly_import(jsonb) to service_role;
