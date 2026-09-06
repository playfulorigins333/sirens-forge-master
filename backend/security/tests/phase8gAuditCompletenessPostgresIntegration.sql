\set ON_ERROR_STOP on

-- Migration establishes exactly one truthful forward-audit boundary.
do $$begin
  if (select count(*) from public.governance_audit_events where action='phase8g.audit_boundary_established')<>1 then
    raise exception 'phase8g boundary audit missing';
  end if;
  if exists(select 1 from public.governance_action_receipts) then
    raise exception 'phase8g migration must not invent historical receipts';
  end if;
end$$;

-- Export lifecycle is audited atomically at each durable state transition.
select * from public.request_creator_data_export(
  '10000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002'
);
select * from public.claim_creator_data_export(
  (select id from public.creator_data_exports where auth_user_id='10000000-0000-4000-8000-000000000002'),
  '10000000-0000-4000-8000-000000000002',
  '31000000-0000-4000-8000-000000000001'
);
select * from public.complete_creator_data_export(
  (select id from public.creator_data_exports where auth_user_id='10000000-0000-4000-8000-000000000002'),
  '10000000-0000-4000-8000-000000000002',
  '31000000-0000-4000-8000-000000000001',
  'private-bucket','creator-exports/test.zip',1234,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  now()+interval '1 day'
);
select * from public.mark_creator_data_export_downloaded(
  (select id from public.creator_data_exports where auth_user_id='10000000-0000-4000-8000-000000000002'),
  '10000000-0000-4000-8000-000000000002'
);

do $$begin
  if (select count(*) from public.governance_audit_events where target_type='data_export' and action in (
    'export.requested','export.processing_started','export.completed','export.downloaded'
  ))<>4 then raise exception 'export lifecycle audit incomplete'; end if;
  if not exists(select 1 from public.governance_audit_events where action='export.requested' and actor_type='creator' and actor_user_id='10000000-0000-4000-8000-000000000002') then
    raise exception 'export request actor attribution missing';
  end if;
  if not exists(select 1 from public.governance_audit_events where action='export.completed' and reference_hashes->>'export_sha256'='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') then
    raise exception 'export completion hash evidence missing';
  end if;
end$$;

-- Account deletion request atomically writes explicit request audit plus the two
-- locked creator receipts: deletion confirmation and export/skip choice.
select * from public.request_voluntary_account_deletion(
  '10000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000003',
  'skip_export',null,'delete-my-account-v1',
  '32000000-0000-4000-8000-000000000001'
);

do $$begin
  if not exists(select 1 from public.governance_audit_events where action='account.deletion_requested' and actor_type='creator' and actor_user_id='10000000-0000-4000-8000-000000000003') then
    raise exception 'account deletion request audit missing';
  end if;
  if (select count(*) from public.governance_action_receipts where actor_user_id='10000000-0000-4000-8000-000000000003')<>2 then
    raise exception 'account deletion receipts incomplete';
  end if;
  if not exists(select 1 from public.governance_action_receipts where receipt_type='account_deletion' and decision='confirmed' and statement_sha256='6837962104899009382198c0c17b490e4eaeedb5cf5b85a1a778d27aecc41aa7') then
    raise exception 'deletion confirmation receipt invalid';
  end if;
  if not exists(select 1 from public.governance_action_receipts where receipt_type='creator_export_choice' and decision='skip_export' and statement_sha256='d16a228c076e477ec7263977f0b22bcf897db8e9b0524e56aafeb39a19802af4') then
    raise exception 'export choice receipt invalid';
  end if;
  if (select count(*) from public.governance_audit_events where action='action_receipt_recorded' and target_type='account_deletion_request')<>2 then
    raise exception 'receipt audit evidence incomplete';
  end if;
end$$;

select * from public.reactivate_voluntary_account_deletion(
  '10000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000003',
  '32000000-0000-4000-8000-000000000002'
);
do $$begin
  if not exists(select 1 from public.governance_audit_events where action='account.deletion_reactivated' and result='reactivated') then
    raise exception 'deletion reactivation audit missing';
  end if;
end$$;

-- Durable billing table changes are audited without storing plaintext provider IDs
-- or purchaser credential material.
insert into public.payment_v2_holds(
  id,purchaser_credential_hash,tier,state,stripe_checkout_session_id,expires_at,referral_code_id
) values (
  '33000000-0000-4000-8000-000000000001',decode(repeat('ab',32),'hex'),'early_bird','HELD',null,now()+interval '30 minutes',null
);
update public.payment_v2_holds set stripe_checkout_session_id='cs_phase8g_secret_reference',updated_at=now()
where id='33000000-0000-4000-8000-000000000001';

insert into public.payment_v2_purchases(
  id,hold_id,purchaser_credential_hash,tier,stripe_checkout_session_id,stripe_customer_id,stripe_price_id,
  stripe_payment_intent_id,stripe_subscription_id,state,provider_event_id,provider_confirmed_at,gross_amount_cents,currency,stripe_source_charge_id
) values (
  '34000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001',decode(repeat('cd',32),'hex'),'early_bird',
  'cs_phase8g_secret_reference','cus_phase8g_secret_reference','price_phase8g_reference','pi_phase8g_secret_reference','sub_phase8g_secret_reference',
  'paid','evt_phase8g_secret_reference',now(),4900,'usd','ch_phase8g_secret_reference'
);
update public.payment_v2_purchases
set claimed_profile_id='20000000-0000-4000-8000-000000000002',claimed_at=now(),state='claimed',updated_at=now()
where id='34000000-0000-4000-8000-000000000001';

insert into public.user_subscriptions(
  id,user_id,tier_name,stripe_subscription_id,stripe_customer_id,status,current_period_start,current_period_end,cancel_at_period_end
) values (
  '35000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','early_bird',
  'sub_phase8g_secret_reference','cus_phase8g_secret_reference','active',now(),now()+interval '30 days',false
);
update public.user_subscriptions set cancel_at_period_end=true,updated_at=now()
where id='35000000-0000-4000-8000-000000000001';
update public.user_subscriptions set status='past_due',updated_at=now()
where id='35000000-0000-4000-8000-000000000001';

insert into public.payment_v2_provider_event_inbox(
  id,provider_event_id,provider_event_type,provider_object_id,provider_object_type,provider_created_at,
  raw_payload_sha256,lifecycle_phase,processing_status,attempt_count
) values (
  '36000000-0000-4000-8000-000000000001','evt_phase8g_secret_reference','customer.subscription.updated',
  'sub_phase8g_secret_reference','subscription',now(),repeat('e',64),'PFC-07E-A3','RECEIVED',0
);
update public.payment_v2_provider_event_inbox
set processing_status='PROCESSED',attempt_count=1,processed_at=now(),updated_at=now()
where id='36000000-0000-4000-8000-000000000001';

do $$begin
  if not exists(select 1 from public.governance_audit_events where action='billing.checkout_hold_created') then raise exception 'hold create audit missing'; end if;
  if not exists(select 1 from public.governance_audit_events where action='billing.checkout_session_associated') then raise exception 'hold session audit missing'; end if;
  if not exists(select 1 from public.governance_audit_events where action='billing.purchase_recorded') then raise exception 'purchase audit missing'; end if;
  if not exists(select 1 from public.governance_audit_events where action='billing.purchase_claimed' and actor_type='creator' and actor_user_id='10000000-0000-4000-8000-000000000002') then raise exception 'purchase claim creator attribution missing'; end if;
  if not exists(select 1 from public.governance_audit_events where action='billing.subscription_recorded') then raise exception 'subscription record audit missing'; end if;
  if not exists(select 1 from public.governance_audit_events where action='billing.subscription_cancellation_scheduled') then raise exception 'subscription cancellation audit missing'; end if;
  if not exists(select 1 from public.governance_audit_events where action='billing.subscription_status_changed') then raise exception 'subscription status audit missing'; end if;
  if not exists(select 1 from public.governance_audit_events where action='billing.provider_event_received') then raise exception 'provider receive audit missing'; end if;
  if not exists(select 1 from public.governance_audit_events where action='billing.provider_event_status_changed') then raise exception 'provider status audit missing'; end if;
end$$;

-- Governance facts stay within the foundation's private-content boundary and
-- plaintext provider identifiers never appear in facts/reference hashes.
do $$begin
  if exists(select 1 from public.governance_audit_events where public.governance_jsonb_has_forbidden_private_key(facts) or public.governance_jsonb_has_forbidden_private_key(reference_hashes)) then
    raise exception 'forbidden private audit key detected';
  end if;
  if exists(select 1 from public.governance_audit_events where facts::text ~ 'cs_phase8g_secret_reference|cus_phase8g_secret_reference|sub_phase8g_secret_reference|pi_phase8g_secret_reference|evt_phase8g_secret_reference|ch_phase8g_secret_reference'
     or reference_hashes::text ~ 'cs_phase8g_secret_reference|cus_phase8g_secret_reference|sub_phase8g_secret_reference|pi_phase8g_secret_reference|evt_phase8g_secret_reference|ch_phase8g_secret_reference') then
    raise exception 'plaintext provider identifier leaked into governance audit';
  end if;
  if exists(select 1 from public.governance_audit_events where facts::text like '%abababababab%' or facts::text like '%cdcdcdcdcdcd%') then
    raise exception 'purchaser credential material leaked into governance audit';
  end if;
end$$;

-- Trigger helpers are not callable APIs. Browser roles cannot write/read governance
-- evidence directly, and service_role cannot directly invoke the trigger helpers.
do $$begin
  if has_function_privilege('anon','public.phase8g_audit_creator_data_export()','EXECUTE')
     or has_function_privilege('authenticated','public.phase8g_audit_creator_data_export()','EXECUTE')
     or has_function_privilege('service_role','public.phase8g_audit_creator_data_export()','EXECUTE')
     or has_function_privilege('anon','public.phase8g_audit_account_deletion()','EXECUTE')
     or has_function_privilege('authenticated','public.phase8g_audit_user_subscription()','EXECUTE')
     or has_function_privilege('service_role','public.phase8g_audit_payment_provider_event()','EXECUTE') then
    raise exception 'phase8g trigger helper execute privilege leaked';
  end if;
  if has_table_privilege('anon','public.governance_audit_events','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','public.governance_action_receipts','SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'browser governance table privilege leaked';
  end if;
end$$;