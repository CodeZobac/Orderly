-- One connection-time review per Notion source. Later discoveries import normally.
create table orderly_private.import_reviews (
 source_id text primary key, user_id text not null, project_id text not null,
 state text not null check(state in ('collecting','queued','analyzing','complete','error')),
 revision integer not null default 0, lease text, lease_until bigint, error text, model text,
 unique(source_id,user_id),
 foreign key(source_id,user_id) references orderly_private.sources(id,user_id),
 foreign key(project_id,user_id) references orderly_private.projects(id,user_id)
);
create table orderly_private.import_review_items (
 source_id text not null, external_task_id text not null, user_id text not null,
 status_key text not null, status_snapshot jsonb not null,
 classification text not null default 'pending' check(classification in ('ready','pending','discarded')),
 decision text not null default 'pending' check(decision in ('ready','pending','discarded')),
 manual_override boolean not null default false, reason text not null default 'Waiting for initial import analysis.',
 conflict boolean not null default false,
 primary key(source_id,external_task_id),
 foreign key(source_id,user_id) references orderly_private.import_reviews(source_id,user_id),
 foreign key(external_task_id,user_id) references orderly_private.external_tasks(id,user_id)
);
create index import_review_task on orderly_private.import_review_items(external_task_id,decision);
create table orderly_private.import_review_requests (
 source_id text not null references orderly_private.import_reviews(source_id), request_id text not null,
 input jsonb not null, result jsonb not null, primary key(source_id,request_id)
);
alter table orderly_private.import_reviews enable row level security;
alter table orderly_private.import_review_items enable row level security;
alter table orderly_private.import_review_requests enable row level security;
revoke all on orderly_private.import_reviews,orderly_private.import_review_items,orderly_private.import_review_requests from public,anon,authenticated;
grant all on orderly_private.import_reviews,orderly_private.import_review_items,orderly_private.import_review_requests to service_role;

create function orderly_private.review_capture() returns trigger
language plpgsql security invoker set search_path='' as $$
declare s orderly_private.sources; e orderly_private.external_tasks;
begin
 select * into s from orderly_private.sources where id=new.source_id;
 if not exists(select 1 from orderly_private.connections where id=s.connection_id and provider='notion') then return new; end if;
 if not exists(select 1 from orderly_private.import_reviews where source_id=s.id and state='collecting') then return new; end if;
 select * into e from orderly_private.external_tasks where id=new.external_task_id;
 insert into orderly_private.import_review_items(source_id,external_task_id,user_id,status_key,status_snapshot,conflict)
 values(s.id,e.id,s.user_id,md5(jsonb_build_array(e.metadata->>'status_id',e.metadata->>'status',e.metadata->>'status_group')::text),
 jsonb_build_object('label',case when coalesce(e.metadata->>'status_id','')='' then '' else coalesce(e.metadata->>'status','') end,'group',coalesce(e.metadata->>'status_group','')),
 exists(select 1 from orderly_private.tasks t where t.id=e.task_id and t.project_id<>s.project_id))
 on conflict(source_id,external_task_id) do update set status_key=excluded.status_key,status_snapshot=excluded.status_snapshot,conflict=excluded.conflict;
 return new;
end $$;
create trigger review_capture after insert or update on orderly_private.source_tasks for each row execute function orderly_private.review_capture();
create function orderly_private.review_source() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from orderly_private.connections where id=new.connection_id and provider='notion') then return new; end if;
 insert into orderly_private.import_reviews(source_id,user_id,project_id,state) values(new.id,new.user_id,new.project_id,'collecting') on conflict do nothing;
 if new.status='synced' and new.last_success is not null then
 delete from orderly_private.import_review_items r where r.source_id=new.id and exists(select 1 from orderly_private.source_tasks st where st.source_id=new.id and st.external_task_id=r.external_task_id and not st.available)
 and exists(select 1 from orderly_private.import_reviews b where b.source_id=new.id and b.state='collecting');
 update orderly_private.import_reviews set state='queued',revision=revision+1 where source_id=new.id and state='collecting';
 end if;
 return new;
end $$;
create trigger review_source after insert or update on orderly_private.sources for each row execute function orderly_private.review_source();
-- Backfill existing imports once. No canonical tasks or attribution are recreated.
insert into orderly_private.import_reviews(source_id,user_id,project_id,state)
 select s.id,s.user_id,s.project_id,case when s.status='synced' and s.last_success is not null then 'queued' else 'collecting' end
 from orderly_private.sources s join orderly_private.connections c on c.id=s.connection_id where c.provider='notion';
insert into orderly_private.import_review_items(source_id,external_task_id,user_id,status_key,status_snapshot,conflict)
 select s.id,e.id,s.user_id,md5(jsonb_build_array(e.metadata->>'status_id',e.metadata->>'status',e.metadata->>'status_group')::text),
 jsonb_build_object('label',case when coalesce(e.metadata->>'status_id','')='' then '' else coalesce(e.metadata->>'status','') end,'group',coalesce(e.metadata->>'status_group','')),
 exists(select 1 from orderly_private.tasks t where t.id=e.task_id and t.project_id<>s.project_id)
 from orderly_private.sources s join orderly_private.import_reviews b on b.source_id=s.id
 join orderly_private.source_tasks st on st.source_id=s.id and st.available join orderly_private.external_tasks e on e.id=st.external_task_id;

create function orderly_private.review_blocked(owner text, task text) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from orderly_private.import_review_items r join orderly_private.external_tasks e on e.id=r.external_task_id
 where r.user_id=owner and e.task_id=task and r.decision<>'ready');
$$;
create function orderly_private.review_entry_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from orderly_private.users where id=new.user_id for update;
 -- Existing work may be stopped, edited, billed and restored without losing history.
 if tg_op='INSERT' or new.task_id is distinct from old.task_id or (old."end" is not null and new."end" is null) or (old.deleted=1 and new.deleted=0 and new."end" is null) then
 if orderly_private.review_blocked(new.user_id,new.task_id) then perform orderly_private.fail('Review and accept this Notion task in Connections before tracking.',409); end if;
 end if;
 return new;
end $$;
create trigger review_entry_guard before insert or update on orderly_private.entries for each row execute function orderly_private.review_entry_guard();

create function public.orderly_review(owner text, command text, input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b orderly_private.import_reviews; row_item orderly_private.import_review_items; result jsonb; prior orderly_private.import_review_requests;
 change record; choice text; prediction jsonb; now_ms bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
begin
 if command='claim' then
 select r.* into b from orderly_private.import_reviews r join orderly_private.sources s on s.id=r.source_id join orderly_private.connections c on c.id=s.connection_id
 where (r.state='queued' or (r.state='analyzing' and r.lease_until<now_ms)) and s.status='synced' and c.status='connected'
 order by r.source_id for update of r skip locked limit 1;
 if not found then return null; end if;
 update orderly_private.import_reviews set state='analyzing',model='deepseek-flash',lease=input->>'lease',lease_until=now_ms+180000,revision=revision+1 where source_id=b.source_id;
 return jsonb_build_object('source_id',b.source_id,'user_id',b.user_id,'statuses',coalesce((select jsonb_agg(v) from
 (select distinct status_key as id,status_snapshot->>'label' as label,status_snapshot->>'group' as "group" from orderly_private.import_review_items where source_id=b.source_id) v),'[]'::jsonb));
 end if;
 perform 1 from orderly_private.users where id=owner for update;
 if not found then perform orderly_private.fail('Sign in to continue.',401); end if;
 if command='list' then
 return coalesce((select jsonb_agg(jsonb_build_object('source_id',r.source_id,'name',s.name,'project_id',r.project_id,'state',r.state,'revision',r.revision,'error',r.error,
 'items',coalesce((select jsonb_agg(jsonb_build_object('external_task_id',i.external_task_id,'name',e.metadata->>'name','url',e.metadata->>'url',
 'status',i.status_snapshot->>'label','classification',i.classification,'decision',i.decision,'reason',i.reason,'conflict',i.conflict) order by e.metadata->>'name',i.external_task_id)
 from orderly_private.import_review_items i join orderly_private.external_tasks e on e.id=i.external_task_id where i.source_id=r.source_id),'[]'::jsonb)))
 from orderly_private.import_reviews r join orderly_private.sources s on s.id=r.source_id where r.user_id=owner),'[]'::jsonb);
 end if;
 select * into b from orderly_private.import_reviews where source_id=input->>'sourceId' and user_id=owner for update;
 if not found then perform orderly_private.fail('Import review not found.',404); end if;
 if command in ('finish','error') then
 if b.state<>'analyzing' or b.lease is distinct from input->>'lease' then return '{}'::jsonb; end if;
 if command='error' then
 update orderly_private.import_review_items set reason='AI analysis is unavailable. Please review manually.' where source_id=b.source_id and not manual_override;
 update orderly_private.import_reviews set state='error',error='AI analysis is unavailable. Retry analysis or review the tasks manually.',lease=null,lease_until=null,revision=revision+1 where source_id=b.source_id;
 return '{}'::jsonb;
 end if;
 for row_item in select * from orderly_private.import_review_items where source_id=b.source_id and not manual_override loop
 select value into prediction from jsonb_array_elements(input->'classifications') where value->>'id'=row_item.status_key limit 1;
 choice:=coalesce(prediction->>'classification','pending');
 if choice not in ('ready','pending','discarded') then choice:='pending'; end if;
 if row_item.conflict then choice:='pending'; end if;
 update orderly_private.import_review_items set classification=choice,decision=choice,
 reason=case when row_item.conflict then 'Existing billing assignment differs. Accept to retain it, or keep this task out of active work.' else left(coalesce(prediction->>'reason','Please review this status.'),240) end
 where source_id=b.source_id and external_task_id=row_item.external_task_id;
 end loop;
 update orderly_private.import_reviews set state='complete',model=left(input->>'model',80),error=null,lease=null,lease_until=null,revision=revision+1 where source_id=b.source_id;
 return '{}'::jsonb;
 elsif command='retry' then
 if b.state<>'error' then return '{}'::jsonb; end if;
 update orderly_private.import_reviews set state='queued',error=null,revision=revision+1 where source_id=b.source_id;
 return '{}'::jsonb;
 elsif command='apply' then
 if length(coalesce(input->>'requestId','')) not between 1 and 100 then perform orderly_private.fail('Missing review request identifier.'); end if;
 select * into prior from orderly_private.import_review_requests where source_id=b.source_id and request_id=input->>'requestId';
 if found then
 if prior.input<>input then perform orderly_private.fail('Review request identifier was reused.',409); end if;
 return prior.result;
 end if;
 if b.state not in ('complete','error') then perform orderly_private.fail('Wait for the initial import analysis to finish.',409); end if;
 if b.revision<>(input->>'revision')::integer then perform orderly_private.fail('This review changed in another tab. Reload it before applying changes.',409); end if;
 if jsonb_typeof(input->'decisions')<>'object' then perform orderly_private.fail('Invalid review decisions.'); end if;
 for change in select key,value from jsonb_each_text(input->'decisions') loop
 if change.value not in ('ready','pending','discarded') then perform orderly_private.fail('Invalid review decision.'); end if;
 if not exists(select 1 from orderly_private.import_review_items where source_id=b.source_id and external_task_id=change.key and user_id=owner) then perform orderly_private.fail('Review item not found.',404); end if;
 update orderly_private.import_review_items set decision=change.value,manual_override=true where source_id=b.source_id and external_task_id=change.key;
 end loop;
 update orderly_private.import_reviews set revision=revision+1 where source_id=b.source_id returning jsonb_build_object('revision',revision) into result;
 insert into orderly_private.import_review_requests values(b.source_id,input->>'requestId',input,result);
 return result;
 end if;
 perform orderly_private.fail('Unknown review action.'); return null;
end $$;
revoke execute on function public.orderly_review(text,text,jsonb),orderly_private.review_capture(),orderly_private.review_source(),orderly_private.review_entry_guard(),orderly_private.review_blocked(text,text) from public,anon,authenticated;
grant execute on function public.orderly_review(text,text,jsonb),orderly_private.review_capture(),orderly_private.review_source(),orderly_private.review_entry_guard(),orderly_private.review_blocked(text,text) to service_role;

-- Preserve the existing baseline/stop logic; only new starts are gated.
create or replace function orderly_private.observe_notion_timer(s orderly_private.sources, c orderly_private.connections, e orderly_private.external_tasks, item jsonb, at_ms bigint) returns void
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
 elsif not prior.doing and is_doing and is_assigned and entry is null and not orderly_private.review_blocked(c.user_id,e.task_id) then
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

-- Keep all tasks in snapshots for historical reports; active selectors filter the flag.
create or replace function public.orderly_snapshot(owner text) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object(
 'user',(select jsonb_build_object('email',email,'timezone',timezone,'timer_limit',timer_limit) from orderly_private.users where id=owner),
 'clients',coalesce((select jsonb_agg(to_jsonb(c) order by id) from orderly_private.clients c where user_id=owner),'[]'::jsonb),
 'projects',coalesce((select jsonb_agg(to_jsonb(p) order by id) from orderly_private.projects p where user_id=owner),'[]'::jsonb),
 'tasks',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('review_blocked',orderly_private.review_blocked(owner,t.id),'external',coalesce((select jsonb_agg(jsonb_build_object(
   'provider',c.provider,'name',e.metadata->>'name','url',e.metadata->>'url','status',e.metadata->>'status','assignee',e.metadata->>'assignee',
   'archived',coalesce((e.metadata->>'archived')::boolean,false),'ambiguous',coalesce((e.metadata->>'ambiguous')::boolean,false),
   'explicit',e.explicit_link,'available',c.status='connected' and exists(select 1 from orderly_private.source_tasks st join orderly_private.sources s on s.id=st.source_id where st.external_task_id=e.id and st.available and s.status<>'inaccessible')))
   from orderly_private.external_tasks e join orderly_private.connections c on c.id=e.connection_id where e.task_id=t.id and e.user_id=owner),'[]'::jsonb)) order by t.id) from orderly_private.tasks t where user_id=owner),'[]'::jsonb),
 'entries',coalesce((select jsonb_agg(to_jsonb(e) order by start desc,id) from orderly_private.entries e where user_id=owner and deleted=0),'[]'::jsonb),
 'audit',coalesce((select jsonb_agg(to_jsonb(a) order by at,id) from orderly_private.audit a where user_id=owner),'[]'::jsonb),
 'now',floor(extract(epoch from clock_timestamp())*1000)::bigint);
$$;

