\set ON_ERROR_STOP on

-- Privilege boundary: browser roles have no access; service_role reaches hold
-- evidence through audited RPCs rather than direct SELECT grants.
do $$
declare signature text;
begin
  if has_table_privilege('anon','public.governance_legal_hold_reviews','SELECT')
     or has_table_privilege('authenticated','public.governance_legal_hold_reviews','SELECT')
     or has_table_privilege('service_role','public.governance_legal_hold_reviews','SELECT')
     or has_table_privilege('service_role','public.governance_legal_holds','SELECT')
     or has_table_privilege('service_role','public.governance_legal_hold_targets','SELECT') then
    raise exception 'phase8f legal-hold direct read boundary mismatch';
  end if;
  foreach signature in array array[
    'public.review_governance_legal_hold(uuid,uuid,text,timestamptz,timestamptz,timestamptz,text,text,uuid,text)',
    'public.release_governance_legal_hold(uuid,uuid,text,timestamptz,text,uuid,text)',
    'public.list_governance_legal_holds_for_admin(uuid,timestamptz,text,text,integer)',
    'public.phase8f_expire_governance_legal_holds(integer)'
  ] loop
    if has_function_privilege('anon',signature,'EXECUTE') or has_function_privilege('authenticated',signature,'EXECUTE') then
      raise exception 'phase8f browser execute leak: %',signature;
    end if;
    if not has_function_privilege('service_role',signature,'EXECUTE') then
      raise exception 'phase8f service_role execute missing: %',signature;
    end if;
  end loop;
  if has_function_privilege('service_role','public.phase8f_assert_founder_admin_fresh_totp(uuid,timestamptz,text)','EXECUTE')
     or has_function_privilege('service_role','public.phase8f_validate_legal_hold_target()','EXECUTE') then
    raise exception 'phase8f internal helper execute leak';
  end if;
end$$;

-- Canonical account target validation.
do $$
begin
  begin
    perform public.open_governance_legal_hold(
      '10000000-0000-4000-8000-000000000001','litigation','invalid account target',null,
      statement_timestamp()+interval '1 day',statement_timestamp()+interval '2 days',statement_timestamp(),'totp',
      'legal-hold-v1','[{"target_type":"account","target_id":"wrong-id","subject_user_id":"10000000-0000-4000-8000-000000000002","preservation_scope":"all_creator_working_data"}]'::jsonb,
      '81000000-0000-4000-8000-000000000001','phase8f_open_bad_account');
    raise exception 'expected invalid account target rejection';
  exception when others then
    if sqlerrm <> 'GOVERNANCE_LEGAL_HOLD_ACCOUNT_TARGET_INVALID' then raise; end if;
  end;
end$$;

-- Account-wide hold inheritance.
select public.open_governance_legal_hold(
  '10000000-0000-4000-8000-000000000001','litigation','account-wide preservation','case-phase8f-account',
  statement_timestamp()+interval '1 day',statement_timestamp()+interval '2 days',statement_timestamp(),'totp',
  'legal-hold-v1','[{"target_type":"account","target_id":"10000000-0000-4000-8000-000000000002","subject_user_id":"10000000-0000-4000-8000-000000000002","preservation_scope":"all_creator_working_data"}]'::jsonb,
  '81000000-0000-4000-8000-000000000002','phase8f_open_account_01');

do $$
declare h uuid;
begin
  select id into h from public.governance_legal_holds where open_idempotency_key='phase8f_open_account_01';
  if h is null
     or not public.governance_target_has_active_legal_hold('generation','generation-arbitrary','10000000-0000-4000-8000-000000000002')
     or not public.governance_target_has_active_legal_hold('private_generation_asset','asset-arbitrary','10000000-0000-4000-8000-000000000002')
     or not public.governance_target_has_active_legal_hold('user_lora','twin-arbitrary','10000000-0000-4000-8000-000000000002')
     or public.governance_target_has_active_legal_hold('generation','generation-arbitrary','10000000-0000-4000-8000-000000000003') then
    raise exception 'phase8f account-wide hold inheritance mismatch';
  end if;
end$$;

-- Review: authority, freshness, no shortening, exact idempotent replay, evidence.
do $$
declare
  h uuid;
  review_id uuid;
  replay_id uuid;
  fresh_at timestamptz := statement_timestamp();
  next_review timestamptz := statement_timestamp()+interval '2 days';
  new_expiry timestamptz := statement_timestamp()+interval '4 days';
begin
  select id into h from public.governance_legal_holds where open_idempotency_key='phase8f_open_account_01';
  begin
    perform public.review_governance_legal_hold(h,'10000000-0000-4000-8000-000000000004','non-admin review',next_review,new_expiry,fresh_at,'totp','legal-hold-v1','81000000-0000-4000-8000-000000000003','phase8f_review_nonadmin');
    raise exception 'expected non-admin review rejection';
  exception when others then if sqlerrm <> 'GOVERNANCE_LEGAL_HOLD_ADMIN_REQUIRED' then raise; end if; end;
  begin
    perform public.review_governance_legal_hold(h,'10000000-0000-4000-8000-000000000001','stale-auth review',next_review,new_expiry,fresh_at-interval '11 minutes','totp','legal-hold-v1','81000000-0000-4000-8000-000000000004','phase8f_review_stale');
    raise exception 'expected stale review rejection';
  exception when others then if sqlerrm <> 'GOVERNANCE_LEGAL_HOLD_FRESH_AUTH_REQUIRED' then raise; end if; end;
  begin
    perform public.review_governance_legal_hold(h,'10000000-0000-4000-8000-000000000001','shorten must fail',statement_timestamp()+interval '1 day',statement_timestamp()+interval '1 day 12 hours',fresh_at,'totp','legal-hold-v1','81000000-0000-4000-8000-000000000005','phase8f_review_shorten');
    raise exception 'expected shortening rejection';
  exception when others then if sqlerrm <> 'GOVERNANCE_LEGAL_HOLD_REVIEW_CANNOT_SHORTEN' then raise; end if; end;

  review_id := public.review_governance_legal_hold(h,'10000000-0000-4000-8000-000000000001','continued preservation required',next_review,new_expiry,fresh_at,'totp','legal-hold-v1','81000000-0000-4000-8000-000000000006','phase8f_review_extend');
  replay_id := public.review_governance_legal_hold(h,'10000000-0000-4000-8000-000000000001','continued preservation required',next_review,new_expiry,fresh_at,'totp','legal-hold-v1','81000000-0000-4000-8000-000000000006','phase8f_review_extend');
  if replay_id is distinct from review_id
     or (select count(*) from public.governance_legal_hold_reviews where hold_id=h and idempotency_key='phase8f_review_extend')<>1
     or not exists(select 1 from public.governance_audit_events a join public.governance_legal_hold_reviews r on r.audit_event_id=a.id where r.id=review_id and a.action='legal_hold_reviewed' and a.result='continued')
     or (select expires_at from public.governance_legal_holds where id=h) is distinct from new_expiry then
    raise exception 'phase8f review evidence/idempotency mismatch';
  end if;
  begin
    update public.governance_legal_hold_reviews set review_reason='tampered' where id=review_id;
    raise exception 'expected review immutability rejection';
  exception when others then if sqlerrm <> 'GOVERNANCE_RECORD_IMMUTABLE' then raise; end if; end;
end$$;

-- Audited admin register read.
do $$
declare payload jsonb;
begin
  begin
    perform public.list_governance_legal_holds_for_admin('10000000-0000-4000-8000-000000000004',statement_timestamp(),'totp',null,50);
    raise exception 'expected non-admin register rejection';
  exception when others then if sqlerrm <> 'GOVERNANCE_LEGAL_HOLD_ADMIN_REQUIRED' then raise; end if; end;
  payload := public.list_governance_legal_holds_for_admin('10000000-0000-4000-8000-000000000001',statement_timestamp(),'totp','active',50);
  if coalesce((payload->>'audited')::boolean,false) is not true
     or coalesce((payload->>'count')::integer,0)<1
     or not exists(select 1 from public.governance_audit_events where action='legal_hold_register_read' and actor_user_id='10000000-0000-4000-8000-000000000001') then
    raise exception 'phase8f audited register read mismatch';
  end if;
end$$;

-- Explicit release path.
select public.open_governance_legal_hold(
  '10000000-0000-4000-8000-000000000001','investigation','manual release path',null,
  statement_timestamp()+interval '1 day',statement_timestamp()+interval '2 days',statement_timestamp(),'totp',
  'legal-hold-v1','[{"target_type":"generation","target_id":"release-generation","subject_user_id":"10000000-0000-4000-8000-000000000003","preservation_scope":"generation_evidence"}]'::jsonb,
  '81000000-0000-4000-8000-000000000007','phase8f_open_release_01');

do $$
declare h uuid;
begin
  select id into h from public.governance_legal_holds where open_idempotency_key='phase8f_open_release_01';
  perform public.release_governance_legal_hold(h,'10000000-0000-4000-8000-000000000001','preservation need ended',statement_timestamp(),'totp','81000000-0000-4000-8000-000000000008','phase8f_release_01');
  if not exists(select 1 from public.governance_legal_holds where id=h and status='released')
     or public.governance_target_has_active_legal_hold('generation','release-generation','10000000-0000-4000-8000-000000000003')
     or not exists(select 1 from public.governance_audit_events where target_id=h::text and action='legal_hold_released') then
    raise exception 'phase8f explicit release mismatch';
  end if;
end$$;

-- Expiry path: simulate elapsed time while preserving finite-window constraints.
select public.open_governance_legal_hold(
  '10000000-0000-4000-8000-000000000001','investigation','automatic expiry path',null,
  statement_timestamp()+interval '1 day',statement_timestamp()+interval '2 days',statement_timestamp(),'totp',
  'legal-hold-v1','[{"target_type":"generation","target_id":"expiry-generation","subject_user_id":"10000000-0000-4000-8000-000000000003","preservation_scope":"generation_evidence"}]'::jsonb,
  '81000000-0000-4000-8000-000000000009','phase8f_open_expiry_01');

update public.governance_legal_holds
set opened_at=statement_timestamp()-interval '3 days',review_due_at=statement_timestamp()-interval '2 days',expires_at=statement_timestamp()-interval '1 day',updated_at=statement_timestamp()
where open_idempotency_key='phase8f_open_expiry_01';

do $$
declare h uuid;
begin
  select id into h from public.governance_legal_holds where open_idempotency_key='phase8f_open_expiry_01';
  begin
    perform public.release_governance_legal_hold(h,'10000000-0000-4000-8000-000000000001','should expire instead',statement_timestamp(),'totp','81000000-0000-4000-8000-000000000010','phase8f_release_expired');
    raise exception 'expected expired manual-release rejection';
  exception when others then if sqlerrm <> 'GOVERNANCE_LEGAL_HOLD_EXPIRED' then raise; end if; end;
end$$;

select * from public.phase8f_expire_governance_legal_holds(50);

do $$
declare h uuid;
begin
  select id into h from public.governance_legal_holds where open_idempotency_key='phase8f_open_expiry_01';
  if not exists(select 1 from public.governance_legal_holds where id=h and status='expired')
     or public.governance_target_has_active_legal_hold('generation','expiry-generation','10000000-0000-4000-8000-000000000003')
     or not exists(select 1 from public.governance_audit_events where target_id=h::text and action='legal_hold_expired' and actor_type='system' and result='expired') then
    raise exception 'phase8f automatic expiry mismatch';
  end if;
end$$;
