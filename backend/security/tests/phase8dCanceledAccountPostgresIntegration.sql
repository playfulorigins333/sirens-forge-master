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

-- Unheld account receives a retryable purge claim and returns its retention cutoff.
do $$declare r record; begin
 select * into strict r from public.phase8d_claim_expired_canceled_accounts(10)
 where auth_user_id='10000000-0000-4000-8000-000000000001';
 if r.claim_state<>'claimed' or r.claim_token is null or r.retention_until is null then raise exception 'due account was not claimed'; end if;
 if not exists(select 1 from public.subscription_cancellation_retentions where id=r.retention_id and state='purge_pending' and purge_claim_token=r.claim_token) then raise exception 'claim state not persisted'; end if;
end$$;

-- Data within the old lifecycle is purgeable; data created after that lifecycle's retention deadline survives.
insert into public.content_posts(id,user_id,status,created_at) values
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','draft',now()-interval '2 days'),
 ('40000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','draft',now());
insert into public.collections(id,user_id,name,created_at) values
 ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','old test',now()-interval '2 days'),
 ('50000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','new test',now());
insert into public.generations(id,user_id,prompt,negative_prompt,metadata,created_at) values
 ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','private prompt','private negative','{"prompt":"private","safe":"keep"}',(now()-interval '2 days')::timestamp),
 ('60000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','new prompt','new negative','{"prompt":"new"}',now()::timestamp);

-- Finalizer removes/scrubs only database-resident working data inside the old retention lifecycle and records audit evidence.
do $$declare rid uuid; token uuid; outrow record; begin
 select id,purge_claim_token into strict rid,token from public.subscription_cancellation_retentions
 where auth_user_id='10000000-0000-4000-8000-000000000001' and state='purge_pending';
 select * into strict outrow from public.phase8d_finalize_canceled_account_purge(rid,'10000000-0000-4000-8000-000000000001',token);
 if not outrow.finalized or outrow.retention_state<>'purged' then raise exception 'account purge did not finalize'; end if;
 if exists(select 1 from public.content_posts where id='40000000-0000-4000-8000-000000000001') then raise exception 'old planner working data survived'; end if;
 if not exists(select 1 from public.content_posts where id='40000000-0000-4000-8000-000000000011') then raise exception 'new planner data was swept by old lifecycle'; end if;
 if exists(select 1 from public.collections where id='50000000-0000-4000-8000-000000000001') then raise exception 'old collection working data survived'; end if;
 if not exists(select 1 from public.collections where id='50000000-0000-4000-8000-000000000011') then raise exception 'new collection was swept by old lifecycle'; end if;
 if exists(select 1 from public.generations where id='60000000-0000-4000-8000-000000000001' and (prompt is not null or negative_prompt is not null)) then raise exception 'old generation text survived'; end if;
 if not exists(select 1 from public.generations where id='60000000-0000-4000-8000-000000000011' and prompt='new prompt') then raise exception 'new generation was scrubbed by old lifecycle'; end if;
 if not exists(select 1 from public.governance_audit_events where action='retention.subscription_cancellation_purged' and target_id=rid::text) then raise exception 'purge audit evidence missing'; end if;
end$$;

-- A creator who re-subscribes before claim must supersede the old cancellation instead of receiving purge authority.
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000004');
insert into public.profiles(id,user_id) values ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004');
insert into public.user_subscriptions(id,user_id,status,tier_name,stripe_subscription_id,current_period_end,cancel_at_period_end) values
 ('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000004','canceled','early_bird','sub_old_resub',now()-interval '61 days',false),
 ('30000000-0000-4000-8000-000000000014','20000000-0000-4000-8000-000000000004','active','early_bird','sub_new_active',now()+interval '30 days',false);
do $$declare r record; rid uuid; begin
 select id into strict rid from public.subscription_cancellation_retentions where subscription_id='30000000-0000-4000-8000-000000000004';
 select * into strict r from public.phase8d_claim_expired_canceled_accounts(10) where retention_id=rid;
 if r.claim_state<>'superseded' or r.claim_token is not null then raise exception 'active re-subscription received destructive claim'; end if;
 if not exists(select 1 from public.subscription_cancellation_retentions where id=rid and state='superseded' and purge_claim_token is null) then raise exception 'old cancellation not superseded'; end if;
 if not exists(select 1 from public.governance_audit_events where action='retention.subscription_cancellation_superseded' and target_id=rid::text) then raise exception 'supersession audit evidence missing'; end if;
end$$;

-- A creator who re-subscribes after claim but before destruction must fail revalidation and supersede the claim.
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000005');
insert into public.profiles(id,user_id) values ('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000005');
insert into public.user_subscriptions(id,user_id,status,tier_name,stripe_subscription_id,current_period_end,cancel_at_period_end)
values ('30000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000005','canceled','early_bird','sub_claim_then_resub',now()-interval '61 days',false);
do $$declare r record; begin
 select * into strict r from public.phase8d_claim_expired_canceled_accounts(10)
 where auth_user_id='10000000-0000-4000-8000-000000000005';
 if r.claim_state<>'claimed' or r.claim_token is null then raise exception 'test lifecycle did not claim'; end if;
end$$;
insert into public.user_subscriptions(id,user_id,status,tier_name,stripe_subscription_id,current_period_end,cancel_at_period_end)
values ('30000000-0000-4000-8000-000000000015','20000000-0000-4000-8000-000000000005','active','early_bird','sub_claim_new_active',now()+interval '30 days',false);
do $$declare rid uuid; token uuid; outrow record; begin
 select id,purge_claim_token into strict rid,token from public.subscription_cancellation_retentions
 where subscription_id='30000000-0000-4000-8000-000000000005';
 select * into strict outrow from public.phase8d_validate_canceled_account_purge(rid,'10000000-0000-4000-8000-000000000005',token);
 if outrow.allowed or outrow.retention_state<>'superseded' then raise exception 're-subscription after claim did not stop destructive work'; end if;
 if not exists(select 1 from public.subscription_cancellation_retentions where id=rid and state='superseded' and purge_claim_token is null) then raise exception 'claimed lifecycle not safely superseded'; end if;
end$$;

-- Legacy binary pointers inside the old lifecycle block false completion instead of being silently discarded.
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000003');
insert into public.profiles(id,user_id) values ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003');
insert into public.user_subscriptions(id,user_id,status,tier_name,stripe_subscription_id,current_period_end,cancel_at_period_end)
values ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','canceled','early_bird','sub_legacy',now()-interval '61 days',false);
insert into public.generations(id,user_id,prompt,r2_key,created_at) values
 ('60000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','legacy','legacy/object.png',(now()-interval '2 days')::timestamp);
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
 if has_function_privilege('authenticated','public.phase8d_validate_canceled_account_purge(uuid,uuid,uuid)','execute') then raise exception 'authenticated validator exposed'; end if;
 if not has_function_privilege('service_role','public.phase8d_validate_canceled_account_purge(uuid,uuid,uuid)','execute') then raise exception 'service validator missing'; end if;
 if has_function_privilege('authenticated','public.phase8d_finalize_canceled_account_purge(uuid,uuid,uuid)','execute') then raise exception 'authenticated finalizer exposed'; end if;
 if not has_function_privilege('service_role','public.phase8d_finalize_canceled_account_purge(uuid,uuid,uuid)','execute') then raise exception 'service finalizer missing'; end if;
end$$;
