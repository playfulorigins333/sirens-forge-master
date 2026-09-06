-- Generated manually because the Supabase CLI is unavailable in this environment.
-- Phase 8G: deletion, billing, and export audit completeness.
-- Production application requires separate explicit authorization.
--
-- Boundaries:
-- - this is forward-looking audit/receipt coverage; it does not invent historical actions;
-- - no billing ledger, entitlement, checkout, retention, deletion, or export state machine is replaced;
-- - no raw provider payload, token, prompt, caption, private binary, or storage object key is written to governance audit;
-- - account deletion confirmation and export/skip choice receipts are written atomically with the deletion request;
-- - Payment V2 and legacy subscription writes are audited at their durable table boundaries;
-- - Phase 9 notification delivery remains intentionally untouched.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $phase8g_preflight$
begin
  if to_regclass('public.creator_data_exports') is null
     or to_regclass('public.account_deletion_requests') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.user_subscriptions') is null
     or to_regclass('public.payment_v2_holds') is null
     or to_regclass('public.payment_v2_purchases') is null
     or to_regclass('public.payment_v2_provider_event_inbox') is null
     or to_regclass('public.governance_audit_events') is null
     or to_regclass('public.governance_action_receipts') is null
     or to_regprocedure('public.append_governance_audit_event(uuid,text,text,text,text,text,text,text,text,text,uuid,text,jsonb,jsonb,uuid)') is null
     or to_regprocedure('public.record_governance_action_receipt(text,uuid,text,uuid,text,text,text,text,text,text,text,jsonb,uuid,text)') is null
  then
    raise exception 'PHASE8G_PREREQUISITE_MISSING';
  end if;
end
$phase8g_preflight$;

create or replace function public.phase8g_audit_creator_data_export()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_action text;
  v_actor_user_id uuid;
  v_actor_type text;
  v_reason_category text;
  v_result text;
  v_facts jsonb;
  v_refs jsonb := '{}'::jsonb;
begin
  if tg_op='INSERT' then
    v_action := 'export.requested';
    v_actor_user_id := new.auth_user_id;
    v_actor_type := case when new.auth_user_id is null then 'service' else 'creator' end;
    v_reason_category := 'privacy_request';
    v_result := 'requested';
  elsif tg_op='UPDATE' then
    if old.status is distinct from new.status then
      case new.status
        when 'processing' then
          v_action := 'export.processing_started';
          v_actor_user_id := null;
          v_actor_type := 'service';
          v_reason_category := 'export_processing';
          v_result := 'processing';
        when 'completed' then
          v_action := 'export.completed';
          v_actor_user_id := null;
          v_actor_type := 'service';
          v_reason_category := 'export_processing';
          v_result := 'completed';
        when 'failed' then
          v_action := 'export.failed';
          v_actor_user_id := null;
          v_actor_type := 'service';
          v_reason_category := 'export_processing';
          v_result := 'failed';
        when 'downloaded' then
          v_action := 'export.downloaded';
          v_actor_user_id := new.auth_user_id;
          v_actor_type := case when new.auth_user_id is null then 'service' else 'creator' end;
          v_reason_category := 'privacy_request';
          v_result := 'downloaded';
        when 'expired' then
          v_action := 'export.expired';
          v_actor_user_id := null;
          v_actor_type := 'system';
          v_reason_category := 'retention_expired';
          v_result := 'expired';
        else
          return new;
      end case;
    elsif new.status='processing'
          and (old.claim_token is distinct from new.claim_token or old.retry_count is distinct from new.retry_count) then
      v_action := 'export.processing_reclaimed';
      v_actor_user_id := null;
      v_actor_type := 'service';
      v_reason_category := 'export_processing';
      v_result := 'processing';
    else
      return new;
    end if;
  else
    return new;
  end if;

  v_facts := jsonb_strip_nulls(jsonb_build_object(
    'from_status', case when tg_op='UPDATE' then old.status else null end,
    'to_status', new.status,
    'export_version', new.export_version,
    'retry_count', new.retry_count,
    'error_code', new.error_code,
    'size_bytes', new.size_bytes,
    'expires_at', new.expires_at,
    'downloaded_at', new.downloaded_at
  ));

  if new.sha256 is not null then
    v_refs := jsonb_build_object('export_sha256',new.sha256);
  end if;

  perform public.append_governance_audit_event(
    v_actor_user_id,v_actor_type,v_action,'data_export',new.id::text,
    v_reason_category,null,v_result,'privacy-data-rights-v1',new.export_version,new.id,null,
    v_facts,v_refs,null
  );
  return new;
end;
$$;
revoke all on function public.phase8g_audit_creator_data_export() from public,anon,authenticated,service_role;

drop trigger if exists phase8g_audit_creator_data_export on public.creator_data_exports;
create trigger phase8g_audit_creator_data_export
after insert or update on public.creator_data_exports
for each row execute function public.phase8g_audit_creator_data_export();

create or replace function public.phase8g_audit_account_deletion()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_action text;
  v_actor_user_id uuid;
  v_actor_type text;
  v_reason_category text;
  v_result text;
  v_correlation uuid;
  v_facts jsonb;
  v_export_statement_sha text;
begin
  if tg_op='INSERT' then
    if new.status<>'pending' or new.auth_user_id is null or new.request_action_id is null then
      return new;
    end if;

    perform public.append_governance_audit_event(
      new.auth_user_id,'creator','account.deletion_requested','account_deletion_request',new.id::text,
      'privacy_request','creator requested voluntary account deletion','pending',new.policy_version,new.confirmation_version,
      new.request_action_id,null,
      jsonb_strip_nulls(jsonb_build_object(
        'export_choice',new.export_choice,
        'export_job_id',new.export_job_id,
        'recovery_deadline',new.recovery_deadline
      )),
      '{}'::jsonb,null
    );

    perform public.record_governance_action_receipt(
      'account_deletion',new.auth_user_id,'creator',new.auth_user_id,
      'account_deletion_request',new.id::text,'request_deletion','confirmed',new.confirmation_version,new.policy_version,
      '6837962104899009382198c0c17b490e4eaeedb5cf5b85a1a778d27aecc41aa7',
      jsonb_strip_nulls(jsonb_build_object('export_choice',new.export_choice,'recovery_deadline',new.recovery_deadline)),
      new.request_action_id,'deletion_' || replace(new.request_action_id::text,'-','_')
    );

    v_export_statement_sha := case new.export_choice
      when 'export_before_deletion' then '9cbf4c6c11a096ec02d0f9b287e483b2b6e1c09b1eda6846ea05775fb8d0a2b4'
      when 'skip_export' then 'd16a228c076e477ec7263977f0b22bcf897db8e9b0524e56aafeb39a19802af4'
      else null
    end;
    if v_export_statement_sha is null then
      raise exception 'PHASE8G_EXPORT_CHOICE_INVALID';
    end if;

    perform public.record_governance_action_receipt(
      'creator_export_choice',new.auth_user_id,'creator',new.auth_user_id,
      'account_deletion_request',new.id::text,'choose_export_handling',new.export_choice,
      'creator-export-choice-v1',new.policy_version,v_export_statement_sha,
      jsonb_strip_nulls(jsonb_build_object('export_job_id',new.export_job_id)),
      new.request_action_id,'export_' || replace(new.request_action_id::text,'-','_')
    );
    return new;
  end if;

  if tg_op<>'UPDATE' then return new; end if;

  if old.status is distinct from new.status then
    if new.status='reactivated' then
      v_action := 'account.deletion_reactivated';
      v_actor_user_id := new.auth_user_id;
      v_actor_type := case when new.auth_user_id is null then 'system' else 'creator' end;
      v_reason_category := 'recovery';
      v_result := 'reactivated';
      v_correlation := coalesce(new.reactivation_action_id,new.id);
    elsif new.status='purge_pending' then
      v_action := 'account.deletion_purge_claimed';
      v_actor_user_id := null;
      v_actor_type := 'system';
      v_reason_category := 'retention_expired';
      v_result := 'purge_pending';
      v_correlation := coalesce(new.purge_claim_token,new.id);
    elsif new.status='completed' then
      v_action := 'account.deletion_completed';
      v_actor_user_id := null;
      v_actor_type := 'system';
      v_reason_category := 'retention_expired';
      v_result := 'completed';
      v_correlation := coalesce(new.completion_action_id,new.id);
    else
      return new;
    end if;
  elsif new.status='purge_pending' and old.purge_claim_token is distinct from new.purge_claim_token then
    v_action := 'account.deletion_purge_reclaimed';
    v_actor_user_id := null;
    v_actor_type := 'system';
    v_reason_category := 'retention_expired';
    v_result := 'purge_pending';
    v_correlation := coalesce(new.purge_claim_token,new.id);
  else
    return new;
  end if;

  v_facts := jsonb_strip_nulls(jsonb_build_object(
    'from_status',old.status,
    'to_status',new.status,
    'export_choice',new.export_choice,
    'recovery_deadline',new.recovery_deadline,
    'reactivated_at',new.reactivated_at,
    'purge_claimed_at',new.purge_claimed_at,
    'purge_completed_at',new.purge_completed_at
  ));

  perform public.append_governance_audit_event(
    v_actor_user_id,v_actor_type,v_action,'account_deletion_request',new.id::text,
    v_reason_category,null,v_result,new.policy_version,new.confirmation_version,v_correlation,null,
    v_facts,'{}'::jsonb,null
  );
  return new;
end;
$$;
revoke all on function public.phase8g_audit_account_deletion() from public,anon,authenticated,service_role;

drop trigger if exists phase8g_audit_account_deletion on public.account_deletion_requests;
create trigger phase8g_audit_account_deletion
after insert or update on public.account_deletion_requests
for each row execute function public.phase8g_audit_account_deletion();

create or replace function public.phase8g_audit_payment_v2_hold()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_action text;
  v_facts jsonb;
  v_refs jsonb := '{}'::jsonb;
begin
  if tg_op='INSERT' then
    v_action := 'billing.checkout_hold_created';
  elsif tg_op='UPDATE' then
    if old.state is distinct from new.state then
      v_action := 'billing.checkout_hold_state_changed';
    elsif old.stripe_checkout_session_id is distinct from new.stripe_checkout_session_id then
      v_action := 'billing.checkout_session_associated';
    elsif old.expires_at is distinct from new.expires_at then
      v_action := 'billing.checkout_hold_expiry_changed';
    else
      return new;
    end if;
  else
    return new;
  end if;

  v_facts := jsonb_strip_nulls(jsonb_build_object(
    'from_state',case when tg_op='UPDATE' then old.state else null end,
    'to_state',new.state,
    'tier',new.tier,
    'expires_at',new.expires_at,
    'has_checkout_session',new.stripe_checkout_session_id is not null,
    'referral_bound',new.referral_code_id is not null
  ));
  if new.stripe_checkout_session_id is not null then
    v_refs := jsonb_build_object(
      'checkout_session_sha256',encode(extensions.digest(new.stripe_checkout_session_id,'sha256'),'hex')
    );
  end if;

  perform public.append_governance_audit_event(
    null,'service',v_action,'billing_hold',new.id::text,
    'billing',null,new.state,'billing-audit-v1',null,new.id,null,v_facts,v_refs,null
  );
  return new;
end;
$$;
revoke all on function public.phase8g_audit_payment_v2_hold() from public,anon,authenticated,service_role;

drop trigger if exists phase8g_audit_payment_v2_hold on public.payment_v2_holds;
create trigger phase8g_audit_payment_v2_hold
after insert or update on public.payment_v2_holds
for each row execute function public.phase8g_audit_payment_v2_hold();

create or replace function public.phase8g_audit_payment_v2_purchase()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_action text;
  v_actor_user_id uuid;
  v_actor_type text := 'service';
  v_facts jsonb;
  v_refs jsonb := '{}'::jsonb;
begin
  if tg_op='INSERT' then
    v_action := 'billing.purchase_recorded';
  elsif tg_op='UPDATE' then
    if old.claimed_at is null and new.claimed_at is not null then
      v_action := 'billing.purchase_claimed';
      if new.claimed_profile_id is not null then
        select p.user_id into v_actor_user_id
        from public.profiles p
        join auth.users u on u.id=p.user_id
        where p.id=new.claimed_profile_id;
        if v_actor_user_id is not null then v_actor_type := 'creator'; end if;
      end if;
    elsif old.state is distinct from new.state then
      v_action := 'billing.purchase_state_changed';
    elsif old.provider_event_id is distinct from new.provider_event_id
       or old.provider_confirmed_at is distinct from new.provider_confirmed_at
       or old.gross_amount_cents is distinct from new.gross_amount_cents
       or old.currency is distinct from new.currency then
      v_action := 'billing.purchase_evidence_updated';
    else
      return new;
    end if;
  else
    return new;
  end if;

  v_facts := jsonb_strip_nulls(jsonb_build_object(
    'from_state',case when tg_op='UPDATE' then old.state else null end,
    'to_state',new.state,
    'tier',new.tier,
    'claimed',new.claimed_at is not null,
    'claimed_profile_id',new.claimed_profile_id,
    'provider_confirmed_at',new.provider_confirmed_at,
    'gross_amount_cents',new.gross_amount_cents,
    'currency',new.currency
  ));
  v_refs := jsonb_strip_nulls(jsonb_build_object(
    'provider_event_sha256',case when new.provider_event_id is null then null else encode(extensions.digest(new.provider_event_id,'sha256'),'hex') end,
    'checkout_session_sha256',case when new.stripe_checkout_session_id is null then null else encode(extensions.digest(new.stripe_checkout_session_id,'sha256'),'hex') end,
    'subscription_sha256',case when new.stripe_subscription_id is null then null else encode(extensions.digest(new.stripe_subscription_id,'sha256'),'hex') end,
    'payment_intent_sha256',case when new.stripe_payment_intent_id is null then null else encode(extensions.digest(new.stripe_payment_intent_id,'sha256'),'hex') end,
    'source_charge_sha256',case when new.stripe_source_charge_id is null then null else encode(extensions.digest(new.stripe_source_charge_id,'sha256'),'hex') end
  ));

  perform public.append_governance_audit_event(
    v_actor_user_id,v_actor_type,v_action,'billing_purchase',new.id::text,
    'billing',null,new.state,'billing-audit-v1',null,new.id,null,v_facts,v_refs,null
  );
  return new;
end;
$$;
revoke all on function public.phase8g_audit_payment_v2_purchase() from public,anon,authenticated,service_role;

drop trigger if exists phase8g_audit_payment_v2_purchase on public.payment_v2_purchases;
create trigger phase8g_audit_payment_v2_purchase
after insert or update on public.payment_v2_purchases
for each row execute function public.phase8g_audit_payment_v2_purchase();

create or replace function public.phase8g_audit_user_subscription()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_action text;
  v_facts jsonb;
  v_refs jsonb := '{}'::jsonb;
begin
  if tg_op='INSERT' then
    v_action := 'billing.subscription_recorded';
  elsif tg_op='UPDATE' then
    if coalesce(old.cancel_at_period_end,false)=false and coalesce(new.cancel_at_period_end,false)=true then
      v_action := 'billing.subscription_cancellation_scheduled';
    elsif coalesce(old.cancel_at_period_end,false)=true and coalesce(new.cancel_at_period_end,false)=false then
      v_action := 'billing.subscription_cancellation_reversed';
    elsif old.status is distinct from new.status then
      v_action := 'billing.subscription_status_changed';
    elsif old.current_period_start is distinct from new.current_period_start
       or old.current_period_end is distinct from new.current_period_end
       or old.canceled_at is distinct from new.canceled_at
       or old.tier_name is distinct from new.tier_name
       or old.stripe_subscription_id is distinct from new.stripe_subscription_id then
      v_action := 'billing.subscription_terms_changed';
    else
      return new;
    end if;
  else
    return new;
  end if;

  v_facts := jsonb_strip_nulls(jsonb_build_object(
    'from_status',case when tg_op='UPDATE' then old.status else null end,
    'to_status',new.status,
    'from_cancel_at_period_end',case when tg_op='UPDATE' then old.cancel_at_period_end else null end,
    'to_cancel_at_period_end',new.cancel_at_period_end,
    'tier_name',new.tier_name,
    'current_period_start',new.current_period_start,
    'current_period_end',new.current_period_end,
    'canceled_at',new.canceled_at,
    'recurring',new.stripe_subscription_id is not null
  ));
  v_refs := jsonb_strip_nulls(jsonb_build_object(
    'subscription_sha256',case when new.stripe_subscription_id is null then null else encode(extensions.digest(new.stripe_subscription_id,'sha256'),'hex') end,
    'customer_sha256',case when new.stripe_customer_id is null then null else encode(extensions.digest(new.stripe_customer_id,'sha256'),'hex') end
  ));

  perform public.append_governance_audit_event(
    null,'service',v_action,'subscription',new.id::text,
    'billing',null,new.status,'billing-audit-v1',null,new.id,null,v_facts,v_refs,null
  );
  return new;
end;
$$;
revoke all on function public.phase8g_audit_user_subscription() from public,anon,authenticated,service_role;

drop trigger if exists phase8g_audit_user_subscription on public.user_subscriptions;
create trigger phase8g_audit_user_subscription
after insert or update on public.user_subscriptions
for each row execute function public.phase8g_audit_user_subscription();

create or replace function public.phase8g_audit_payment_provider_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_action text;
  v_facts jsonb;
  v_refs jsonb;
begin
  if tg_op='INSERT' then
    v_action := 'billing.provider_event_received';
  elsif tg_op='UPDATE' then
    if old.processing_status is not distinct from new.processing_status
       and old.attempt_count is not distinct from new.attempt_count
       and old.last_error_code is not distinct from new.last_error_code then
      return new;
    end if;
    v_action := 'billing.provider_event_status_changed';
  else
    return new;
  end if;

  v_facts := jsonb_strip_nulls(jsonb_build_object(
    'provider_event_type',new.provider_event_type,
    'provider_object_type',new.provider_object_type,
    'provider_created_at',new.provider_created_at,
    'lifecycle_phase',new.lifecycle_phase,
    'from_processing_status',case when tg_op='UPDATE' then old.processing_status else null end,
    'to_processing_status',new.processing_status,
    'attempt_count',new.attempt_count,
    'last_error_code',new.last_error_code
  ));
  v_refs := jsonb_build_object(
    'raw_payload_sha256',lower(new.raw_payload_sha256),
    'provider_event_sha256',encode(extensions.digest(new.provider_event_id,'sha256'),'hex'),
    'provider_object_sha256',encode(extensions.digest(new.provider_object_id,'sha256'),'hex')
  );

  perform public.append_governance_audit_event(
    null,'service',v_action,'billing_event',new.id::text,
    'billing_provider_event',null,new.processing_status,'billing-audit-v1',new.lifecycle_phase,new.id,null,
    v_facts,v_refs,null
  );
  return new;
end;
$$;
revoke all on function public.phase8g_audit_payment_provider_event() from public,anon,authenticated,service_role;

drop trigger if exists phase8g_audit_payment_provider_event on public.payment_v2_provider_event_inbox;
create trigger phase8g_audit_payment_provider_event
after insert or update on public.payment_v2_provider_event_inbox
for each row execute function public.phase8g_audit_payment_provider_event();

-- Establish a truthful forward-audit boundary without pretending to reconstruct
-- actions that occurred before Phase 8G existed.
do $phase8g_boundary$
declare
  v_correlation uuid := gen_random_uuid();
  v_facts jsonb;
begin
  v_facts := jsonb_build_object(
    'creator_data_exports',(select count(*) from public.creator_data_exports),
    'account_deletion_requests',(select count(*) from public.account_deletion_requests),
    'user_subscriptions',(select count(*) from public.user_subscriptions),
    'payment_v2_holds',(select count(*) from public.payment_v2_holds),
    'payment_v2_purchases',(select count(*) from public.payment_v2_purchases),
    'payment_v2_provider_events',(select count(*) from public.payment_v2_provider_event_inbox)
  );
  perform public.append_governance_audit_event(
    null,'system','phase8g.audit_boundary_established','governance_phase','phase8g',
    'governance_activation','forward audit coverage enabled; no historical actions inferred','established',
    'phase8g-audit-v1','phase8g-audit-boundary-v1',v_correlation,null,v_facts,'{}'::jsonb,null
  );
end
$phase8g_boundary$;

commit;