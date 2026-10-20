-- Exact UTC milliseconds; rates remain hundredths of currency units/hour.
-- Serialize billing and tracker writes on the same independent owner row.
create table orderly_private.billing_batches (
 id text primary key, user_id text not null references orderly_private.users(id),
 status text not null default 'draft' check(status in ('draft','finalized','void')),
 filters jsonb not null, snapshot jsonb not null, version integer not null default 1,
 created_at bigint not null, finalized_at bigint, voided_at bigint, void_reason text,
 unique(id,user_id)
);
create table orderly_private.billing_allocations (
 id text primary key, user_id text not null, batch_id text not null, entry_id text not null,
 start_ms bigint not null, end_ms bigint not null, released boolean not null default false,
 check(end_ms>start_ms), foreign key(batch_id,user_id) references orderly_private.billing_batches(id,user_id),
 foreign key(entry_id,user_id) references orderly_private.entries(id,user_id)
);
create index billing_owner_created on orderly_private.billing_batches(user_id,created_at);
create index billing_active_entry on orderly_private.billing_allocations(user_id,entry_id,start_ms,end_ms) where not released;
create index billing_batch on orderly_private.billing_allocations(batch_id,user_id);
create table orderly_private.billing_audit (
 id text primary key, user_id text not null references orderly_private.users(id), batch_id text,
 action text not null, detail jsonb not null, at bigint not null,
 foreign key(batch_id,user_id) references orderly_private.billing_batches(id,user_id)
);
create index billing_audit_owner on orderly_private.billing_audit(user_id,at);

-- No extension required. ISO minor-unit precision; rate input stays at 2 decimals.
create function orderly_private.currency_digits(code text) returns integer language sql immutable security invoker set search_path='' as $$
 -- SIX ISO 4217 monetary precision list published 2026-09-17; unsupported codes block billing.
 select case
 when code in ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF') then 0
 when code in ('BHD','IQD','JOD','KWD','LYD','OMR','TND') then 3
 when code in ('CLF','UYW') then 4
 when code in ('AED','AFN','ALL','AMD','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BMD','BND','BOB','BOV','BRL','BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHE','CHF','CHW','CNY','COP','COU','CRC','CUP','CVE','CZK','DKK','DOP','DZD','EGP','ERN','ETB','EUR','FJD','FKP','GBP','GEL','GHS','GIP','GMD','GTQ','GYD','HKD','HNL','HTG','HUF','IDR','ILS','INR','IRR','JMD','KES','KGS','KHR','KPW','KYD','KZT','LAK','LBP','LKR','LRD','LSL','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MXV','MYR','MZN','NAD','NGN','NIO','NOK','NPR','NZD','PAB','PEN','PGK','PHP','PKR','PLN','QAR','RON','RSD','RUB','SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLE','SOS','SRD','SSP','STN','SVC','SYP','SZL','THB','TJS','TMT','TOP','TRY','TTD','TWD','TZS','UAH','USD','USN','UYU','UZS','VED','VES','WST','XAD','XCD','XCG','YER','ZAR','ZMW','ZWG') then 2
 else null end;
$$;
create function orderly_private.billing_entry_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from orderly_private.users where id=old.user_id for update;
 if exists(select 1 from orderly_private.billing_allocations where user_id=old.user_id and entry_id=old.id and not released) then
 perform orderly_private.fail('This entry belongs to a finalized report. Void every report using it before correcting it.',409); end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger billing_entry_lock before update or delete on orderly_private.entries for each row execute function orderly_private.billing_entry_guard();
create function orderly_private.billing_batch_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.status<>'draft' then
 if tg_op='DELETE' then perform orderly_private.fail('Finalized reports are retained permanently.',409); end if;
 if old.status<>'finalized' or new.status<>'void' or new.snapshot<>old.snapshot or new.filters<>old.filters or new.id<>old.id or new.user_id<>old.user_id or new.created_at<>old.created_at or new.finalized_at is distinct from old.finalized_at or nullif(btrim(new.void_reason),'') is null then
 perform orderly_private.fail('Finalized snapshots are immutable. Use an audited void and reissue.',409); end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger billing_snapshot_lock before update or delete on orderly_private.billing_batches for each row execute function orderly_private.billing_batch_guard();
create function orderly_private.billing_allocation_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then perform orderly_private.fail('Billing allocation history is permanent.',409); end if;
 perform 1 from orderly_private.users where id=new.user_id for update;
 if tg_op='UPDATE' then
 if (to_jsonb(new)-'released')<>(to_jsonb(old)-'released') or old.released or not new.released or not exists(select 1 from orderly_private.billing_batches where id=new.batch_id and user_id=new.user_id and status='void') then
 perform orderly_private.fail('Billing allocations can only be released by voiding their report.',409); end if;
 else
 if new.released or not exists(select 1 from orderly_private.billing_batches where id=new.batch_id and user_id=new.user_id and status='finalized') then perform orderly_private.fail('Finalize before reserving time.',409); end if;
 if exists(select 1 from orderly_private.billing_allocations a where a.user_id=new.user_id and a.entry_id=new.entry_id and not a.released and a.start_ms<new.end_ms and a.end_ms>new.start_ms) then perform orderly_private.fail('This time was already finalized. Refresh the review.',409); end if;
 end if; return new;
end $$;
create trigger billing_allocation_lock before insert or update or delete on orderly_private.billing_allocations for each row execute function orderly_private.billing_allocation_guard();

create function orderly_private.billing_review(owner text, filters jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare begin_ms bigint; end_ms bigint; zone text; lines jsonb; totals jsonb; issues jsonb; long_ids jsonb;
begin
 zone:=orderly_private.label(filters->'timezone','Timezone');
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then perform orderly_private.fail('Choose a valid timezone.'); end if;
 if coalesce(filters->>'from','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(filters->>'to','') !~ '^\d{4}-\d{2}-\d{2}$' then perform orderly_private.fail('Choose start and exclusive end dates.'); end if;
 begin
 begin_ms:=(extract(epoch from ((filters->>'from')::date::timestamp at time zone zone))*1000)::bigint;
 end_ms:=(extract(epoch from ((filters->>'to')::date::timestamp at time zone zone))*1000)::bigint;
 exception when invalid_datetime_format or datetime_field_overflow then perform orderly_private.fail('Choose valid calendar dates.'); end;
 if begin_ms<0 or end_ms<=begin_ms or (filters->>'to')::date-(filters->>'from')::date>366 then perform orderly_private.fail('Choose a period of 1 to 366 days.'); end if;
 if nullif(filters->>'projectId','') is not null then perform orderly_private.owned('projects',filters->'projectId',owner); end if;
 if nullif(filters->>'clientId','') is not null then perform orderly_private.owned('clients',filters->'clientId',owner); end if;
 -- Stop running work first, even if another allocation from it would be empty.
 select coalesce(jsonb_agg(jsonb_build_object('entryId',e.id,'message',case when e."end" is null then 'Stop this running entry.' when e."end"<=e.start then 'Invalid interval.' when e.rate is null or e.rate<0 then 'Missing or invalid rate.' else 'Currency differs from its project or has no supported ISO minor-unit precision.' end) order by e.id),'[]'::jsonb)
 into issues from orderly_private.entries e join orderly_private.tasks t on t.id=e.task_id and t.user_id=owner join orderly_private.projects p on p.id=t.project_id and p.user_id=owner
 where e.user_id=owner and e.deleted=0 and e.start<end_ms and (e."end" is null or e."end">begin_ms)
 and (nullif(filters->>'projectId','') is null or p.id=filters->>'projectId') and (nullif(filters->>'clientId','') is null or p.client_id=filters->>'clientId')
 and (e."end" is null or e."end"<=e.start or e.rate is null or e.rate<0 or e.currency<>p.currency or orderly_private.currency_digits(e.currency) is null);
 -- Subtract the union of previous active allocations, retaining half-open boundaries.
 with selected as (
 select e.*,t.name task,p.id project_id,p.name project,c.id client_id,c.name client,
 greatest(e.start,begin_ms) lo,least(e."end",end_ms) hi
 from orderly_private.entries e join orderly_private.tasks t on t.id=e.task_id and t.user_id=owner join orderly_private.projects p on p.id=t.project_id and p.user_id=owner join orderly_private.clients c on c.id=p.client_id and c.user_id=owner
 where e.user_id=owner and e.deleted=0 and e."end" is not null and e."end">e.start and e.rate is not null and e.rate>=0 and e.currency=p.currency and orderly_private.currency_digits(e.currency) is not null and e.start<end_ms and e."end">begin_ms
 and (nullif(filters->>'projectId','') is null or p.id=filters->>'projectId') and (nullif(filters->>'clientId','') is null or c.id=filters->>'clientId')
 ), parts as (
 select s.*,lower(r) allocation_start,upper(r) allocation_end from selected s cross join lateral unnest(
 int8multirange(int8range(s.lo,s.hi,'[)'))-coalesce((select range_agg(int8range(a.start_ms,a.end_ms,'[)')) from orderly_private.billing_allocations a where a.user_id=owner and a.entry_id=s.id and not a.released),'{}'::int8multirange)) r
 ), exact as (
 select *,allocation_end-allocation_start ms,
 case when billable=1 then (allocation_end-allocation_start)::numeric*rate*power(10::numeric,orderly_private.currency_digits(currency)) else 0 end numerator
 from parts
 ), ranked as (
 select *,floor(numerator/360000000) base,
 row_number() over(partition by currency order by mod(numerator,360000000) desc,id,allocation_start) rank,
 round(sum(numerator) over(partition by currency)/360000000)-sum(floor(numerator/360000000)) over(partition by currency) extra from exact
 ) select coalesce(jsonb_agg(jsonb_build_object(
 'entryId',id,'revision',version,'taskId',task_id,'task',task,'projectId',project_id,'project',project,'clientId',client_id,'client',client,
 'start',allocation_start,'end',allocation_end,'recordedMs',ms,'billedMs',case when billable=1 then ms else 0 end,'billable',billable=1,
 'rate',rate,'currency',currency,'digits',orderly_private.currency_digits(currency),'notes',notes,'sourceStart',start,'sourceEnd',"end",
 'numerator',numerator::text,'denominator','360000000','minorAmount',(base+case when rank<=extra then 1 else 0 end)::text,
 'evidence',coalesce((select jsonb_agg(ev order by ev->>'url') from (
 select jsonb_build_object('kind',conn.provider,'label',x.metadata->>'name','url',x.metadata->>'url') ev from orderly_private.external_tasks x join orderly_private.connections conn on conn.id=x.connection_id where x.user_id=owner and x.task_id=ranked.task_id
 union all select jsonb_build_object('kind','github','label',pr.metadata->>'title','url',pr.metadata->>'url') from orderly_private.pr_links l join orderly_private.pull_requests pr on pr.id=l.pr_id where l.user_id=owner and l.task_id=ranked.task_id and l.status='confirmed'
 ) evidence),'[]'::jsonb)
 ) order by allocation_start,id),'[]'::jsonb) into lines from ranked;
 select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'digits',digits,'recordedMs',recorded_ms,'billableMs',billable_ms,'nonBillableMs',recorded_ms-billable_ms,'minorAmount',amount::text) order by currency),'[]'::jsonb)
 into totals from (select x->>'currency' currency,(x->>'digits')::integer digits,sum((x->>'recordedMs')::bigint) recorded_ms,sum((x->>'billedMs')::bigint) billable_ms,sum((x->>'minorAmount')::numeric) amount from jsonb_array_elements(lines) x group by 1,2) sums;
 select coalesce(jsonb_agg(distinct x->>'entryId' order by x->>'entryId'),'[]'::jsonb) into long_ids from jsonb_array_elements(lines) x where (x->>'sourceEnd')::bigint-(x->>'sourceStart')::bigint>43200000;
 return jsonb_build_object('filters',filters,'start',begin_ms,'end',end_ms,'policy','Exact milliseconds; sum exact amounts per currency, round half up to ISO minor units. Distribute minor units by largest remainder, ties by entry ID/start. No time rounding.',
 'lines',lines,'totals',totals,'issues',issues,'longEntryIds',long_ids,
 'alreadyAllocatedMs',coalesce((select sum(least(e."end",end_ms)-greatest(e.start,begin_ms)) from orderly_private.entries e join orderly_private.tasks t on t.id=e.task_id join orderly_private.projects p on p.id=t.project_id where e.user_id=owner and e.deleted=0 and e."end" is not null and e."end">e.start and e.rate is not null and e.rate>=0 and e.currency=p.currency and orderly_private.currency_digits(e.currency) is not null and e.start<end_ms and e."end">begin_ms and (nullif(filters->>'projectId','') is null or p.id=filters->>'projectId') and (nullif(filters->>'clientId','') is null or p.client_id=filters->>'clientId')),0)-coalesce((select sum((x->>'recordedMs')::bigint) from jsonb_array_elements(lines) x),0));
end $$;

create function public.orderly_billing(owner text, command text, input jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare b orderly_private.billing_batches; review jsonb; rid text; request_key text; prior orderly_private.requests; result jsonb; item jsonb; entry jsonb; now_ms bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint; reason text;
begin
 perform 1 from orderly_private.users where id=owner for update;
 if not found then perform orderly_private.fail('Sign in to continue.',401); end if;
 if command='list' then return jsonb_build_object('batches',coalesce((select jsonb_agg(to_jsonb(x)-'snapshot' order by created_at desc,id) from orderly_private.billing_batches x where user_id=owner),'[]'::jsonb),'audit',coalesce((select jsonb_agg(to_jsonb(x) order by at desc,id) from orderly_private.billing_audit x where user_id=owner),'[]'::jsonb)); end if;
 if command='get' then select * into b from orderly_private.billing_batches where id=input->>'batchId' and user_id=owner; if not found then perform orderly_private.fail('Report not found.',404); end if; return to_jsonb(b); end if;
 if command='preview' then return orderly_private.billing_review(owner,input->'filters'); end if;
 request_key:=orderly_private.label(input->'key','Request key',100);
 select * into prior from orderly_private.requests where user_id=owner and key=request_key;
 if found then if prior.payload<>jsonb_build_object('billing',command,'input',input) then perform orderly_private.fail('Request key already used.',409); end if; return prior.result; end if;
 if command='draft' then
 review:=orderly_private.billing_review(owner,input->'filters'); rid:=gen_random_uuid()::text;
 insert into orderly_private.billing_batches(id,user_id,filters,snapshot,created_at) values(rid,owner,input->'filters',review,now_ms);
 insert into orderly_private.billing_audit values(gen_random_uuid()::text,owner,rid,'draft',jsonb_build_object('filters',input->'filters'),now_ms);
 elsif command='rate' then
 entry:=orderly_private.owned('entries',input->'entryId',owner);
 if entry->>'end' is null or (entry->>'deleted')::integer=1 then perform orderly_private.fail('Choose a stopped, visible entry.'); end if;
 if input->'version' is distinct from entry->'version' then perform orderly_private.fail('Entry changed. Refresh before overriding its rate.',409); end if;
 reason:=orderly_private.label(input->'reason','Override reason',2000);
 update orderly_private.entries set rate=orderly_private.rate(input->'rate'),version=version+1 where id=entry->>'id' and user_id=owner;
 perform orderly_private.log_entry(owner,entry->>'id','billing_rate',entry,now_ms);
 insert into orderly_private.billing_audit values(gen_random_uuid()::text,owner,null,'rate',jsonb_build_object('entryId',entry->>'id','beforeRate',entry->'rate','afterRate',orderly_private.rate(input->'rate'),'reason',reason),now_ms);
 result:='{"ok":true}'::jsonb;
 else
 select * into b from orderly_private.billing_batches where id=input->>'batchId' and user_id=owner for update;
 if not found then perform orderly_private.fail('Report not found.',404); end if; rid:=b.id;
 if input->'version' is distinct from to_jsonb(b.version) then perform orderly_private.fail('Report changed. Reload it.',409); end if;
 if command='refresh' then
 if b.status<>'draft' then perform orderly_private.fail('Only drafts can be refreshed.',409); end if;
 review:=orderly_private.billing_review(owner,b.filters);
 update orderly_private.billing_batches set snapshot=review,version=version+1 where id=b.id;
 insert into orderly_private.billing_audit values(gen_random_uuid()::text,owner,b.id,'refresh','{}',now_ms);
 elsif command='finalize' then
 if b.status<>'draft' then perform orderly_private.fail('This report was already finalized or voided.',409); end if;
 review:=orderly_private.billing_review(owner,b.filters);
 if review<>b.snapshot then perform orderly_private.fail('Work, evidence, or allocations changed. Refresh and review the draft again.',409); end if;
 if jsonb_array_length(review->'issues')>0 or jsonb_array_length(review->'lines')=0 then perform orderly_private.fail('Resolve review issues and include unbilled stopped work before finalizing.',409); end if;
 if jsonb_typeof(input->'reviewedLong') is distinct from 'array' or not (input->'reviewedLong' @> review->'longEntryIds') then perform orderly_private.fail('Explicitly review every entry longer than 12 hours.'); end if;
 update orderly_private.billing_batches set status='finalized',finalized_at=now_ms,version=version+1 where id=b.id;
 for item in select value from jsonb_array_elements(review->'lines') loop
 insert into orderly_private.billing_allocations values(gen_random_uuid()::text,owner,b.id,item->>'entryId',(item->>'start')::bigint,(item->>'end')::bigint,false);
 end loop;
 insert into orderly_private.billing_audit values(gen_random_uuid()::text,owner,b.id,'finalize',jsonb_build_object('reviewedLong',input->'reviewedLong'),now_ms);
 elsif command='void' then
 if b.status<>'finalized' then perform orderly_private.fail('Only finalized reports can be voided.',409); end if;
 reason:=orderly_private.label(input->'reason','Void reason',2000);
 update orderly_private.billing_batches set status='void',voided_at=now_ms,void_reason=reason,version=version+1 where id=b.id;
 update orderly_private.billing_allocations set released=true where batch_id=b.id and user_id=owner and not released;
 insert into orderly_private.billing_audit values(gen_random_uuid()::text,owner,b.id,'void',jsonb_build_object('reason',reason),now_ms);
 else perform orderly_private.fail('Unknown billing action.'); end if;
 end if;
 if result is null then select to_jsonb(x) into result from orderly_private.billing_batches x where id=rid; end if;
 insert into orderly_private.requests values(owner,request_key,jsonb_build_object('billing',command,'input',input),result); return result;
end $$;

do $$ declare t text; begin foreach t in array array['billing_batches','billing_allocations','billing_audit'] loop
 execute format('alter table orderly_private.%I enable row level security',t);
 execute format('revoke all on orderly_private.%I from public,anon,authenticated',t);
 execute format('grant select,insert,update,delete on orderly_private.%I to service_role',t);
 end loop; end $$;
revoke execute on function orderly_private.currency_digits(text),orderly_private.billing_entry_guard(),orderly_private.billing_batch_guard(),orderly_private.billing_allocation_guard(),orderly_private.billing_review(text,jsonb),public.orderly_billing(text,text,jsonb) from public,anon,authenticated;
grant execute on function orderly_private.currency_digits(text),orderly_private.billing_entry_guard(),orderly_private.billing_batch_guard(),orderly_private.billing_allocation_guard(),orderly_private.billing_review(text,jsonb),public.orderly_billing(text,text,jsonb) to service_role;

-- Owned operational status; no credentials, leases, tokens or provider payloads.
create function public.orderly_operations(owner text) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('now',floor(extract(epoch from clock_timestamp())*1000)::bigint,
 'sources',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'provider',c.provider,'status',s.status,'connectionStatus',c.status,'lastSuccess',s.last_success,'queued',j.id is not null,'attempts',coalesce(j.attempts,0),'availableAt',j.available_at,'leaseUntil',j.lease_until) order by s.name,s.id)
 from orderly_private.sources s join orderly_private.connections c on c.id=s.connection_id left join orderly_private.sync_jobs j on j.source_id=s.id where s.user_id=owner),'[]'::jsonb));
$$;
revoke execute on function public.orderly_operations(text) from public,anon,authenticated;
grant execute on function public.orderly_operations(text) to service_role;
