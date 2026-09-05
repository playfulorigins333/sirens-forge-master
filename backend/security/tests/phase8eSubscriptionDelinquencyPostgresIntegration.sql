\set ON_ERROR_STOP on

-- Locked central policy remains 60 days.
do $$declare v interval;begin
  select retention_duration into v from public.current_retention_policy('subscription_delinquency_after_second_miss',statement_timestamp());
  if v<>interval '60 days' then raise exception 'phase8e_policy_duration_mismatch'; end if;
end$$;

-- Legal hold blocks a due delinquency before claim.
insert into auth.users(id) values('81000000-0000-4000-8000-000000000001');
insert into public.profiles(id,user_id) values('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001');
insert into public.user_subscriptions(id,user_id,status,tier_name,stripe_subscription_id,current_period_start,current_period_end,created_at)
values('83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','past_due','early_bird','sub_hold',now()-interval '100 days',now()-interval '70 days',now()-interval '150 days');
insert into public.subscription_payment_delinquencies(id,auth_user_id,profile_id,subscription_id,stripe_subscription_id,state,first_missed_invoice_id,first_missed_at,second_missed_invoice_id,second_missed_at,consecutive_missed_cycles,retention_started_at,retention_until)
values('84000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','sub_hold','retention_countdown','in_hold_1',now()-interval '100 days','in_hold_2',now()-interval '70 days',2,now()-interval '70 days',now()-interval '10 days');
insert into public.governance_test_holds values('subscription_payment_delinquency','84000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001');
do $$declare r record;begin
  select * into r from public.phase8e_claim_expired_delinquent_accounts(1);
  if r.claim_state<>'held' or r.claim_token is not null then raise exception 'phase8e_hold_not_enforced'; end if;
end$$;
delete from public.governance_test_holds where target_id='84000000-0000-4000-8000-000000000001';
update public.subscription_payment_delinquencies set state='superseded' where id='84000000-0000-4000-8000-000000000001';

-- New subscription before claim supersedes the old delinquency lifecycle.
insert into auth.users(id) values('81000000-0000-4000-8000-000000000002');
insert into public.profiles(id,user_id) values('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002');
insert into public.user_subscriptions(id,user_id,status,tier_name,stripe_subscription_id,current_period_start,current_period_end,created_at)
values('83000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000002','past_due','early_bird','sub_old',now()-interval '100 days',now()-interval '70 days',now()-interval '150 days');
insert into public.subscription_payment_delinquencies(id,auth_user_id,profile_id,subscription_id,stripe_subscription_id,state,first_missed_invoice_id,first_missed_at,second_missed_invoice_id,second_missed_at,consecutive_missed_cycles,retention_started_at,retention_until)
values('84000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000002','sub_old','retention_countdown','in_old_1',now()-interval '100 days','in_old_2',now()-interval '70 days',2,now()-interval '70 days',now()-interval '10 days');
insert into public.user_subscriptions(id,user_id,status,tier_name,stripe_subscription_id,current_period_start,current_period_end,created_at)
values('83000000-0000-4000-8000-000000000012','82000000-0000-4000-8000-000000000002','active','early_bird','sub_new',now()-interval '5 days',now()+interval '25 days',now()-interval '5 days');
do $$declare r record;begin
  select * into r from public.phase8e_claim_expired_delinquent_accounts(10) where delinquency_id='84000000-0000-4000-8000-000000000002';
  if r.claim_state<>'superseded' then raise exception 'phase8e_new_subscription_not_superseded'; end if;
  if not exists(select 1 from public.subscription_payment_delinquencies where id=r.delinquency_id and state='superseded' and purge_claim_token is null) then raise exception 'phase8e_supersede_state_failed'; end if;
end$$;

-- Recovery after claim blocks destruction.
insert into auth.users(id) values('81000000-0000-4000-8000-000000000003');
insert into public.profiles(id,user_id) values('82000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000003');
insert into public.user_subscriptions(id,user_id,status,tier_name,stripe_subscription_id,current_period_start,current_period_end,created_at)
values('83000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000003','past_due','early_bird','sub_recover',now()-interval '100 days',now()-interval '70 days',now()-interval '150 days');
insert into public.subscription_payment_delinquencies(id,auth_user_id,profile_id,subscription_id,stripe_subscription_id,state,first_missed_invoice_id,first_missed_at,second_missed_invoice_id,second_missed_at,consecutive_missed_cycles,retention_started_at,retention_until)
values('84000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000000003','sub_recover','retention_countdown','in_rec_1',now()-interval '100 days','in_rec_2',now()-interval '70 days',2,now()-interval '70 days',now()-interval '10 days');
do $$declare r record; v uuid;begin
  select * into r from public.phase8e_claim_expired_delinquent_accounts(10) where delinquency_id='84000000-0000-4000-8000-000000000003';
  if r.claim_state<>'claimed' or r.claim_token is null then raise exception 'phase8e_recovery_claim_missing'; end if;
  v:=r.claim_token;
  update public.subscription_payment_delinquencies set state='recovered',recovered_at=now(),recovery_invoice_id='in_paid',recovery_billing_period_start=now()-interval '1 day',recovery_billing_period_end=now()+interval '29 days' where id=r.delinquency_id;
  select * into r from public.phase8e_validate_delinquent_account_purge('84000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000003',v);
  if r.allowed or r.delinquency_state<>'recovered' then raise exception 'phase8e_recovery_after_claim_not_blocked'; end if;
end$$;

-- A newer subscription appearing after claim is caught by revalidation.
insert into auth.users(id) values('81000000-0000-4000-8000-000000000004');
insert into public.profiles(id,user_id) values('82000000-0000-4000-8000-000000000004','81000000-0000-4000-8000-000000000004');
insert into public.user_subscriptions(id,user_id,status,tier_name,stripe_subscription_id,current_period_start,current_period_end,created_at)
values('83000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000004','past_due','early_bird','sub_race',now()-interval '100 days',now()-interval '70 days',now()-interval '150 days');
insert into public.subscription_payment_delinquencies(id,auth_user_id,profile_id,subscription_id,stripe_subscription_id,state,first_missed_invoice_id,first_missed_at,second_missed_invoice_id,second_missed_at,consecutive_missed_cycles,retention_started_at,retention_until)
values('84000000-0000-4000-8000-000000000004','81000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000004','83000000-0000-4000-8000-000000000004','sub_race','retention_countdown','in_race_1',now()-interval '100 days','in_race_2',now()-interval '70 days',2,now()-interval '70 days',now()-interval '10 days');
do $$declare r record; v uuid;begin
  select * into r from public.phase8e_claim_expired_delinquent_accounts(10) where delinquency_id='84000000-0000-4000-8000-000000000004';
  v:=r.claim_token;
  insert into public.user_subscriptions(id,user_id,status,tier_name,stripe_subscription_id,current_period_start,current_period_end,created_at)
  values('83000000-0000-4000-8000-000000000014','82000000-0000-4000-8000-000000000004','active','early_bird','sub_race_new',now()-interval '1 day',now()+interval '29 days',now()-interval '1 day');
  select * into r from public.phase8e_validate_delinquent_account_purge('84000000-0000-4000-8000-000000000004','81000000-0000-4000-8000-000000000004',v);
  if r.allowed or r.delinquency_state<>'superseded' then raise exception 'phase8e_revalidation_race_failed'; end if;
end$$;

-- Normal due lifecycle purges old working rows, normalizes physical purge reason, and preserves delinquency evidence.
insert into auth.users(id) values('81000000-0000-4000-8000-000000000005');
insert into public.profiles(id,user_id) values('82000000-0000-4000-8000-000000000005','81000000-0000-4000-8000-000000000005');
insert into public.user_subscriptions(id,user_id,status,tier_name,stripe_subscription_id,current_period_start,current_period_end,created_at)
values('83000000-0000-4000-8000-000000000005','82000000-0000-4000-8000-000000000005','past_due','early_bird','sub_purge',now()-interval '100 days',now()-interval '70 days',now()-interval '150 days');
insert into public.subscription_payment_delinquencies(id,auth_user_id,profile_id,subscription_id,stripe_subscription_id,state,first_missed_invoice_id,first_missed_at,second_missed_invoice_id,second_missed_at,consecutive_missed_cycles,retention_started_at,retention_until)
values('84000000-0000-4000-8000-000000000005','81000000-0000-4000-8000-000000000005','82000000-0000-4000-8000-000000000005','83000000-0000-4000-8000-000000000005','sub_purge','retention_countdown','in_purge_1',now()-interval '100 days','in_purge_2',now()-interval '70 days',2,now()-interval '70 days',now()-interval '10 days');
insert into public.subscription_payment_delinquency_invoices(delinquency_id,auth_user_id,profile_id,subscription_id,stripe_subscription_id,provider_invoice_id,billing_period_start,billing_period_end,first_failure_observed_at,first_provider_event_id)
values('84000000-0000-4000-8000-000000000005','81000000-0000-4000-8000-000000000005','82000000-0000-4000-8000-000000000005','83000000-0000-4000-8000-000000000005','sub_purge','in_purge_2',now()-interval '100 days',now()-interval '70 days',now()-interval '70 days','evt_purge');
insert into public.content_posts(id,user_id,created_at) values('85000000-0000-4000-8000-000000000005','81000000-0000-4000-8000-000000000005',now()-interval '20 days');
insert into public.collections(id,user_id,name,created_at) values('86000000-0000-4000-8000-000000000005','81000000-0000-4000-8000-000000000005','old',now()-interval '20 days');
insert into public.generations(id,user_id,prompt,negative_prompt,lora_used,body_type,metadata,created_at) values('87000000-0000-4000-8000-000000000005','81000000-0000-4000-8000-000000000005','secret prompt','secret neg','secret lora','secret body','{"prompt":"secret","keep":"ok"}',(now()-interval '20 days')::timestamp);
insert into public.generation_assets(id,generation_id,owner_id,lifecycle_state,created_at) values('88000000-0000-4000-8000-000000000005','87000000-0000-4000-8000-000000000005','81000000-0000-4000-8000-000000000005','active',now()-interval '20 days');
insert into public.user_loras(id,user_id,lifecycle_state,training_data_state,created_at) values('89000000-0000-4000-8000-000000000005','81000000-0000-4000-8000-000000000005','active','active',(now()-interval '20 days')::timestamp);
do $$declare r record; v uuid;begin
  select * into r from public.phase8e_claim_expired_delinquent_accounts(10) where delinquency_id='84000000-0000-4000-8000-000000000005';
  v:=r.claim_token;
  update public.generation_assets set purge_reason='creator_permanent_delete',lifecycle_state='purged' where id='88000000-0000-4000-8000-000000000005';
  update public.user_loras set purge_reason='creator_permanent_delete',lifecycle_state='purged' where id='89000000-0000-4000-8000-000000000005';
  if exists(select 1 from public.generation_assets where id='88000000-0000-4000-8000-000000000005' and purge_reason<>'retention_expired') then raise exception 'phase8e_media_reason_not_normalized'; end if;
  if exists(select 1 from public.user_loras where id='89000000-0000-4000-8000-000000000005' and purge_reason<>'retention_expired') then raise exception 'phase8e_twin_reason_not_normalized'; end if;
  select * into r from public.phase8e_finalize_delinquent_account_purge('84000000-0000-4000-8000-000000000005','81000000-0000-4000-8000-000000000005',v);
  if not r.finalized or r.delinquency_state<>'purged' or r.blocked_count<>0 then raise exception 'phase8e_finalize_failed'; end if;
end$$;
do $$begin
  if exists(select 1 from public.content_posts where user_id='81000000-0000-4000-8000-000000000005') then raise exception 'phase8e_content_not_deleted'; end if;
  if exists(select 1 from public.collections where user_id='81000000-0000-4000-8000-000000000005') then raise exception 'phase8e_collection_not_deleted'; end if;
  if exists(select 1 from public.generations where id='87000000-0000-4000-8000-000000000005' and (prompt is not null or negative_prompt is not null or lora_used is not null or body_type is not null)) then raise exception 'phase8e_generation_not_scrubbed'; end if;
  if not exists(select 1 from public.subscription_payment_delinquencies where id='84000000-0000-4000-8000-000000000005' and state='retention_countdown' and purge_completed_at is not null and purge_claim_token is null) then raise exception 'phase8e_evidence_state_not_preserved'; end if;
  if not exists(select 1 from public.subscription_payment_delinquency_invoices where delinquency_id='84000000-0000-4000-8000-000000000005') then raise exception 'phase8e_invoice_evidence_deleted'; end if;
  if not exists(select 1 from public.governance_audit_events where action='retention.subscription_delinquency_purged' and target_id='84000000-0000-4000-8000-000000000005') then raise exception 'phase8e_audit_missing'; end if;
end$$;

-- Post-deadline/anomalous working data survives cutoff and blocks false completion.
insert into auth.users(id) values('81000000-0000-4000-8000-000000000006');
insert into public.profiles(id,user_id) values('82000000-0000-4000-8000-000000000006','81000000-0000-4000-8000-000000000006');
insert into public.user_subscriptions(id,user_id,status,tier_name,stripe_subscription_id,created_at) values('83000000-0000-4000-8000-000000000006','82000000-0000-4000-8000-000000000006','past_due','early_bird','sub_block',now()-interval '150 days');
insert into public.subscription_payment_delinquencies(id,auth_user_id,profile_id,subscription_id,stripe_subscription_id,state,first_missed_invoice_id,first_missed_at,second_missed_invoice_id,second_missed_at,consecutive_missed_cycles,retention_started_at,retention_until)
values('84000000-0000-4000-8000-000000000006','81000000-0000-4000-8000-000000000006','82000000-0000-4000-8000-000000000006','83000000-0000-4000-8000-000000000006','sub_block','retention_countdown','in_block_1',now()-interval '100 days','in_block_2',now()-interval '70 days',2,now()-interval '70 days',now()-interval '10 days');
insert into public.content_posts(id,user_id,created_at) values('85000000-0000-4000-8000-000000000006','81000000-0000-4000-8000-000000000006',now());
do $$declare r record; v uuid;begin
  select * into r from public.phase8e_claim_expired_delinquent_accounts(10) where delinquency_id='84000000-0000-4000-8000-000000000006'; v:=r.claim_token;
  select * into r from public.phase8e_finalize_delinquent_account_purge('84000000-0000-4000-8000-000000000006','81000000-0000-4000-8000-000000000006',v);
  if r.finalized or r.blocked_count<1 then raise exception 'phase8e_post_deadline_false_finalize'; end if;
  if not exists(select 1 from public.content_posts where id='85000000-0000-4000-8000-000000000006') then raise exception 'phase8e_post_deadline_data_deleted'; end if;
end$$;

-- Direct browser roles cannot execute enforcement RPCs; service_role can.
do $$begin
  if has_function_privilege('anon','public.phase8e_claim_expired_delinquent_accounts(integer)','EXECUTE') then raise exception 'phase8e_anon_claim_exec'; end if;
  if has_function_privilege('authenticated','public.phase8e_validate_delinquent_account_purge(uuid,uuid,uuid)','EXECUTE') then raise exception 'phase8e_authenticated_validate_exec'; end if;
  if has_function_privilege('authenticated','public.phase8e_finalize_delinquent_account_purge(uuid,uuid,uuid)','EXECUTE') then raise exception 'phase8e_authenticated_finalize_exec'; end if;
  if not has_function_privilege('service_role','public.phase8e_claim_expired_delinquent_accounts(integer)','EXECUTE') then raise exception 'phase8e_service_claim_missing'; end if;
  if not has_function_privilege('service_role','public.phase8e_validate_delinquent_account_purge(uuid,uuid,uuid)','EXECUTE') then raise exception 'phase8e_service_validate_missing'; end if;
  if not has_function_privilege('service_role','public.phase8e_finalize_delinquent_account_purge(uuid,uuid,uuid)','EXECUTE') then raise exception 'phase8e_service_finalize_missing'; end if;
end$$;
