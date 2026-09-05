\set ON_ERROR_STOP on

insert into auth.users(id) values
 ('10000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002');
insert into public.profiles(id,user_id) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');

insert into public.user_subscriptions(id,user_id,status,tier_name,stripe_subscription_id,current_period_end,cancel_at_period_end) values
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','canceled','early_bird','sub_due',now()-interval '61 days',false),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','canceled','early_bird','sub_held',now()-interval '61 days',false);

-- Central policy is authoritative but can never shorten the locked sixty-day minimum.
do $$declare r record; begin
 select * into strict r from public.subscription_cancellation_retentions where subscription_id='30000000-0000-4000-8000-000000000001';
 if r.retention_until < r.paid_access_ends_at+interval '60 days' then raise exception 'cancellation retention shortened'; end if;
 if r.state<>'expired' then raise exception 'expired cancellation not ready'; end if;
end$$;

-- Hold on the account prevents claim but does not change the expired retention state.
insert into public.governance_test_holds(target_type,target_id,subject_user_id)
values ('account','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');
do $$declare r record; begin
 select * into strict r from public.phase8d_claim_expired_canceled_accounts(10)
 where auth_user_id='10000000-0000-4000-8000-000000000002';
 if r.claim_state<>'held' or r.claim_token is not null then raise exception 'held account was destructively claimed'; end if;
end$$;

-- Unheld account receives a retryable purge claim.
do $$declare r record; begin
 select * into strict r from public.phase8d_claim_expired_canceled_accounts(10)
 where auth_user_id='10000000-0000-4000-8000-000000000001';
 if r.claim_state<>'claimed' or r.claim_token is null then raise exception 'due account was not claimed'; end if;
 if not exists(select 1 from public.subscription_cancellation_retentions where id=r.retention_id and state='purge_pending' and purge_claim_token=r.claim_token) then raise exception 'claim state not persisted'; end if;
end$$;

insert into public.content_posts(id,user_id,status) values
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','draft');
insert into public.collections(id,user_id,name) values
 ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','test');
insert into public.generations(id,user_id,prompt,negative_prompt,metadata) values
 ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','private prompt','private negative','{"prompt":"private","safe":"keep"}');

-- Finalizer removes/scrubs database-resident working data and records immutable audit evidence.
do $$declare rid uuid; token uuid; outrow record; begin
 select id,purge_claim_token into strict rid,token from public.subscription_cancellation_retentions
 where auth_user_id='10000000-0000-4000-8000-000000000001' and state='purge_pending';
 select * into strict outrow from public.phase8d_finalize_canceled_account_purge(rid,'10000000-0000-4000-8000-000000000001',token);
 if not outrow.finalized or outrow.retention_state<>'purged' then raise exception 'account purge did not finalize'; end if;
 if exists(select 1 from public.content_posts where user_id='10000000-0000-4000-8000-000000000001') then raise exception 'planner working data survived'; end if;
 if exists(select 1 from public.collections where user_id='10000000-0000-4000-8000-000000000001') then raise exception 'collection working data survived'; end if;
 if exists(select 1 from public.generations where id='60000000-0000-4000-8000-000000000001' and (prompt is not null or negative_prompt is not null)) then raise exception 'generation text survived'; end if;
 if not exists(select 1 from public.governance_audit_events where action='retention.subscription_cancellation_purged' and target_id=rid::text) then raise exception 'purge audit evidence missing'; end if;
end$$;

-- Legacy binary pointers block false completion instead of being silently discarded.
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000003');
insert into public.profiles(id,user_id) values ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003');
insert into public.user_subscriptions(id,user_id,status,tier_name,stripe_subscription_id,current_period_end,cancel_at_period_end)
values ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','canceled','early_bird','sub_legacy',now()-interval '61 days',false);
insert into public.generations(id,user_id,prompt,r2_key) values
 ('60000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','legacy','legacy/object.png');
do $$declare rid uuid; token uuid; outrow record; begin
 perform * from public.phase8d_claim_expired_canceled_accounts(10);
 select id,purge_claim_token into strict rid,token from public.subscription_cancellation_retentions
 where auth_user_id='10000000-0000-4000-8000-000000000003' and state='purge_pending';
 select * into strict outrow from public.phase8d_finalize_canceled_account_purge(rid,'10000000-0000-4000-8000-000000000003',token);
 if outrow.finalized or outrow.blocked_count<1 then raise exception 'legacy binary falsely finalized'; end if;
 if not exists(select 1 from public.generations where id='60000000-0000-4000-8000-000000000003' and r2_key='legacy/object.png') then raise exception 'legacy pointer silently discarded'; end if;
end$$;

-- Public/browser roles cannot invoke destructive Phase 8D functions.
do $$begin
 if has_function_privilege('anon','public.phase8d_claim_expired_canceled_accounts(integer)','execute') then raise exception 'anon claim exposed'; end if;
 if has_function_privilege('authenticated','public.phase8d_claim_expired_canceled_accounts(integer)','execute') then raise exception 'authenticated claim exposed'; end if;
 if not has_function_privilege('service_role','public.phase8d_claim_expired_canceled_accounts(integer)','execute') then raise exception 'service claim missing'; end if;
 if has_function_privilege('authenticated','public.phase8d_finalize_canceled_account_purge(uuid,uuid,uuid)','execute') then raise exception 'authenticated finalizer exposed'; end if;
 if not has_function_privilege('service_role','public.phase8d_finalize_canceled_account_purge(uuid,uuid,uuid)','execute') then raise exception 'service finalizer missing'; end if;
end$$;
