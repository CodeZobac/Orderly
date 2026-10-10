-- Reuse private, expiring, session-bound OAuth state for temporary operator setup.
-- Empty verifier means waiting; a received token is AES-GCM ciphertext, never plaintext.
create function public.orderly_notion_setup(owner text, command text, input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare state orderly_private.oauth_states;
 now_ms bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
begin
 perform 1 from orderly_private.users where id=owner for update;
 if not found then perform orderly_private.fail('Sign in to continue.',401); end if;
 if command='capture' then
 select * into state from orderly_private.oauth_states where hash=input->>'hash' and user_id=owner and provider='notion_webhook_setup' for update;
 if not found or state.expires<=now_ms then perform orderly_private.fail('Notion verification capture expired. Start setup again.',410); end if;
 if not exists(select 1 from orderly_private.sessions where token=state.session_token and user_id=owner and expires>now_ms) then perform orderly_private.fail('Notion verification capture session expired.',410); end if;
 -- First delivery wins. A resend never replaces the captured token.
 if state.verifier='' then
 if coalesce(input->>'token','') not like 'v1.%' then perform orderly_private.fail('Invalid encrypted verification token.'); end if;
 update orderly_private.oauth_states set verifier=input->>'token' where hash=state.hash;
 end if;
 return '{}'::jsonb;
 end if;
 if not exists(select 1 from orderly_private.sessions where token=input->>'session' and user_id=owner and expires>now_ms) then perform orderly_private.fail('Sign in again before setting up Notion webhooks.',401); end if;
 if command='begin' then
 delete from orderly_private.oauth_states where user_id=owner and provider='notion_webhook_setup';
 if coalesce(input->>'hash','') !~ '^[a-f0-9]{64}$' then perform orderly_private.fail('Invalid setup capability.'); end if;
 insert into orderly_private.oauth_states values(input->>'hash',owner,'notion_webhook_setup','',now_ms+600000,input->>'session');
 return jsonb_build_object('expiresAt',now_ms+600000);
 elsif command='discard' then
 delete from orderly_private.oauth_states where user_id=owner and provider='notion_webhook_setup' and session_token=input->>'session';
 return '{}'::jsonb;
 end if;
 select * into state from orderly_private.oauth_states where user_id=owner and provider='notion_webhook_setup' and session_token=input->>'session' and expires>now_ms for update;
 if command='status' then
 return jsonb_build_object('active',state.hash is not null,'received',coalesce(state.verifier<>'',false),'expiresAt',state.expires);
 elsif command='retrieve' then
 if state.hash is null or state.verifier='' then perform orderly_private.fail('No Notion verification token received. Update the webhook URL and click Resend token in Notion.',409); end if;
 return to_jsonb(state.verifier);
 end if;
 perform orderly_private.fail('Unknown Notion setup action.'); return null;
end $$;
create index oauth_states_setup_owner on orderly_private.oauth_states(user_id,session_token) where provider='notion_webhook_setup';
revoke execute on function public.orderly_notion_setup(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.orderly_notion_setup(text,text,jsonb) to service_role;
