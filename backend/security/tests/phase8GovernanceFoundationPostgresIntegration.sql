\set ON_ERROR_STOP on

-- Retention versions preserve Phase 7 durations and are readable only through the
-- privileged service path.
do $$
begin
  if (select count(*) from public.retention_policy_versions) <> 5 then
    raise exception 'phase8 retention seed count mismatch';
  end if;
  if not exists(select 1 from public.retention_policy_versions where policy_key='private_generation_asset_trash' and retention_duration=interval '30 days')
     or not exists(select 1 from public.retention_policy_versions where policy_key='twin_trash' and retention_duration=interval '30 days')
     or not exists(select 1 from public.retention_policy_versions where policy_key='voluntary_account_deletion' and retention_duration=interval '60 days')
     or not exists(select 1 from public.retention_policy_versions where policy_key='subscription_cancellation' and retention_duration=interval '60 days')
     or not exists(select 1 from public.retention_policy_versions where policy_key='subscription_delinquency_after_second_miss' and retention_duration=interval '60 days') then
    raise exception 'phase8 retention duration mismatch';
  end if;
end
$$;

do $$
declare
  relation text;
begin
  foreach relation in array array[
    'public.retention_policy_versions',
    'public.governance_audit_events',
    'public.governance_action_receipts',
    'public.governance_legal_holds',
    'public.governance_legal_hold_targets'
  ] loop
    if has_table_privilege('anon',relation,'SELECT')
       or has_table_privilege('anon',relation,'INSERT')
       or has_table_privilege('anon',relation,'UPDATE')
       or has_table_privilege('anon',relation,'DELETE')
       or has_table_privilege('authenticated',relation,'SELECT')
       or has_table_privilege('authenticated',relation,'INSERT')
       or has_table_privilege('authenticated',relation,'UPDATE')
       or has_table_privilege('authenticated',relation,'DELETE') then
      raise exception 'browser role unexpectedly has governance table access: %', relation;
    end if;
  end loop;

  if not has_table_privilege('service_role','public.retention_policy_versions','SELECT')
     or not has_table_privilege('service_role','public.governance_action_receipts','SELECT')
     or not has_table_privilege('service_role','public.governance_legal_holds','SELECT')
     or not has_table_privilege('service_role','public.governance_legal_hold_targets','SELECT')
     or has_table_privilege('service_role','public.governance_audit_events','SELECT') then
    raise exception 'service_role governance read boundary mismatch';
  end if;

  foreach relation in array array[
    'public.retention_policy_versions',
    'public.governance_audit_events',
    'public.governance_action_receipts',
    'public.governance_legal_holds',
    'public.governance_legal_hold_targets'
  ] loop
    if has_table_privilege('service_role',relation,'INSERT')
       or has_table_privilege('service_role',relation,'UPDATE')
       or has_table_privilege('service_role',relation,'DELETE') then
      raise exception 'service_role unexpectedly has direct governance mutation access: %', relation;
    end if;
  end loop;
end
$$;

do $$
declare
  signature text;
begin
  foreach signature in array array[
    'public.append_governance_audit_event(uuid,text,text,text,text,text,text,text,text,text,uuid,text,jsonb,jsonb,uuid)',
    'public.record_governance_action_receipt(text,uuid,text,uuid,text,text,text,text,text,text,text,jsonb,uuid,text)',
    'public.open_governance_legal_hold(uuid,text,text,text,timestamptz,timestamptz,timestamptz,text,text,jsonb,uuid,text)',
    'public.release_governance_legal_hold(uuid,uuid,text,timestamptz,text,uuid,text)',
    'public.governance_target_has_active_legal_hold(text,text,uuid)'
  ] loop
    if has_function_privilege('anon',signature,'EXECUTE') or has_function_privilege('authenticated',signature,'EXECUTE') then
      raise exception 'browser role unexpectedly can execute governance RPC: %', signature;
    end if;
    if not has_function_privilege('service_role',signature,'EXECUTE') then
      raise exception 'service_role missing governance RPC execution: %', signature;
    end if;
  end loop;
end
$$;

-- Hash-chain and append-only behavior.
select public.append_governance_audit_event(
  '10000000-0000-4000-8000-000000000002','creator','phase8_test_event','creator','10000000-0000-4000-8000-000000000002',
  'test',null,'ok',null,null,'20000000-0000-4000-8000-000000000001',null,'{}'::jsonb,'{}'::jsonb,null
) as first_audit_id \gset
select public.append_governance_audit_event(
  '10000000-0000-4000-8000-000000000003','creator','phase8_test_event_2','creator','10000000-0000-4000-8000-000000000003',
  'test',null,'ok',null,null,'20000000-0000-4000-8000-000000000002',null,'{}'::jsonb,'{}'::jsonb,null
) as second_audit_id \gset

do $$
declare
  first_hash text;
  second_previous text;
  second_hash text;
begin
  select event_hash into first_hash from public.governance_audit_events where id=:'first_audit_id'::uuid;
  select previous_event_hash,event_hash into second_previous,second_hash from public.governance_audit_events where id=:'second_audit_id'::uuid;
  if first_hash !~ '^[0-9a-f]{64}$' or second_hash !~ '^[0-9a-f]{64}$' or second_previous is distinct from first_hash then
    raise exception 'governance audit hash chain mismatch';
  end if;
end
$$;

do $$
begin
  begin
    update public.governance_audit_events set result='tampered' where id=:'first_audit_id'::uuid;
    raise exception 'expected audit update rejection';
  exception when others then
    if sqlerrm <> 'GOVERNANCE_RECORD_IMMUTABLE' then raise; end if;
  end;
  begin
    delete from public.governance_audit_events where id=:'first_audit_id'::uuid;
    raise exception 'expected audit delete rejection';
  exception when others then
    if sqlerrm <> 'GOVERNANCE_RECORD_IMMUTABLE' then raise; end if;
  end;
  begin
    perform public.append_governance_audit_event(
      '10000000-0000-4000-8000-000000000002','creator','phase8_private_reject','creator','10000000-0000-4000-8000-000000000002',
      'test',null,'blocked',null,null,'20000000-0000-4000-8000-000000000003',null,
      '{"nested":{"access_token":"forbidden"}}'::jsonb,'{}'::jsonb,null
    );
    raise exception 'expected private audit evidence rejection';
  exception when others then
    if sqlerrm <> 'GOVERNANCE_AUDIT_PRIVATE_CONTENT_FORBIDDEN' then raise; end if;
  end;
end
$$;

-- Creator receipt idempotency, ownership, admin-only access, and immutability.
select public.record_governance_action_receipt(
  'ai_likeness_identity_consent','10000000-0000-4000-8000-000000000002','creator','10000000-0000-4000-8000-000000000002',
  'creator','10000000-0000-4000-8000-000000000002','consent','accepted','ai-likeness-v1',null,
  repeat('a',64),'{}'::jsonb,'30000000-0000-4000-8000-000000000001','receipt_key_0001'
) as creator_receipt_id \gset
select public.record_governance_action_receipt(
  'ai_likeness_identity_consent','10000000-0000-4000-8000-000000000002','creator','10000000-0000-4000-8000-000000000002',
  'creator','10000000-0000-4000-8000-000000000002','consent','accepted','ai-likeness-v1',null,
  repeat('a',64),'{}'::jsonb,'30000000-0000-4000-8000-000000000001','receipt_key_0001'
) as creator_receipt_replay_id \gset

do $$
begin
  if :'creator_receipt_id'::uuid is distinct from :'creator_receipt_replay_id'::uuid then
    raise exception 'receipt idempotent replay returned a different id';
  end if;
  begin
    perform public.record_governance_action_receipt(
      'ai_likeness_identity_consent','10000000-0000-4000-8000-000000000002','creator','10000000-0000-4000-8000-000000000002',
      'creator','10000000-0000-4000-8000-000000000002','consent','declined','ai-likeness-v1',null,
      repeat('a',64),'{}'::jsonb,'30000000-0000-4000-8000-000000000001','receipt_key_0001'
    );
    raise exception 'expected receipt idempotency conflict';
  exception when others then
    if sqlerrm <> 'GOVERNANCE_RECEIPT_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;
  begin
    perform public.record_governance_action_receipt(
      'ai_likeness_identity_consent','10000000-0000-4000-8000-000000000002','creator','10000000-0000-4000-8000-000000000003',
      'creator','10000000-0000-4000-8000-000000000003','consent','accepted','ai-likeness-v1',null,
      repeat('b',64),'{}'::jsonb,'30000000-0000-4000-8000-000000000002','receipt_key_0002'
    );
    raise exception 'expected creator subject-scope rejection';
  exception when others then
    if sqlerrm <> 'GOVERNANCE_RECEIPT_ACTOR_SCOPE_INVALID' then raise; end if;
  end;
  begin
    perform public.record_governance_action_receipt(
      'admin_private_content_access','10000000-0000-4000-8000-000000000004','founder_admin','10000000-0000-4000-8000-000000000003',
      'private_asset','asset-1','view','approved','admin-private-access-v1',null,
      repeat('c',64),'{}'::jsonb,'30000000-0000-4000-8000-000000000003','receipt_key_0003'
    );
    raise exception 'expected non-admin private-access rejection';
  exception when others then
    if sqlerrm <> 'GOVERNANCE_RECEIPT_ADMIN_REQUIRED' then raise; end if;
  end;
end
$$;

select public.record_governance_action_receipt(
  'admin_private_content_access','10000000-0000-4000-8000-000000000001','founder_admin','10000000-0000-4000-8000-000000000003',
  'private_asset','asset-1','view','approved','admin-private-access-v1',null,
  repeat('d',64),'{}'::jsonb,'30000000-0000-4000-8000-000000000004','receipt_key_0004'
) as admin_receipt_id \gset

do $$
begin
  begin
    update public.governance_action_receipts set decision='tampered' where id=:'creator_receipt_id'::uuid;
    raise exception 'expected receipt update rejection';
  exception when others then
    if sqlerrm <> 'GOVERNANCE_RECORD_IMMUTABLE' then raise; end if;
  end;
end
$$;

-- Legal-hold authority, fresh TOTP, cross-user target identity, active lookup,
-- release behavior, expiry behavior, and target immutability.
do $$
begin
  begin
    perform public.open_governance_legal_hold(
      '10000000-0000-4000-8000-000000000004','litigation','non-admin must fail',null,
      statement_timestamp()+interval '1 day',statement_timestamp()+interval '2 days',statement_timestamp(),'totp',
      'legal-hold-v1','[{"target_type":"private_asset","target_id":"same-object","subject_user_id":"10000000-0000-4000-8000-000000000002","preservation_scope":"binary_and_metadata"}]'::jsonb,
      '40000000-0000-4000-8000-000000000001','hold_key_0001'
    );
    raise exception 'expected legal-hold admin rejection';
  exception when others then
    if sqlerrm <> 'GOVERNANCE_LEGAL_HOLD_ADMIN_REQUIRED' then raise; end if;
  end;
  begin
    perform public.open_governance_legal_hold(
      '10000000-0000-4000-8000-000000000001','litigation','stale TOTP must fail',null,
      statement_timestamp()+interval '1 day',statement_timestamp()+interval '2 days',statement_timestamp()-interval '11 minutes','totp',
      'legal-hold-v1','[{"target_type":"private_asset","target_id":"same-object","subject_user_id":"10000000-0000-4000-8000-000000000002","preservation_scope":"binary_and_metadata"}]'::jsonb,
      '40000000-0000-4000-8000-000000000002','hold_key_0002'
    );
    raise exception 'expected stale TOTP rejection';
  exception when others then
    if sqlerrm <> 'GOVERNANCE_LEGAL_HOLD_FRESH_AUTH_REQUIRED' then raise; end if;
  end;
end
$$;

select public.open_governance_legal_hold(
  '10000000-0000-4000-8000-000000000001','litigation','preserve two subject-scoped records','case-123',
  statement_timestamp()+interval '1 day',statement_timestamp()+interval '2 days',statement_timestamp(),'totp',
  'legal-hold-v1',
  '[{"target_type":"private_asset","target_id":"same-object","subject_user_id":"10000000-0000-4000-8000-000000000002","preservation_scope":"binary_and_metadata"},{"target_type":"private_asset","target_id":"same-object","subject_user_id":"10000000-0000-4000-8000-000000000003","preservation_scope":"binary_and_metadata"}]'::jsonb,
  '40000000-0000-4000-8000-000000000003','hold_key_0003'
) as active_hold_id \gset

do $$
begin
  if (select count(*) from public.governance_legal_hold_targets where hold_id=:'active_hold_id'::uuid) <> 2 then
    raise exception 'cross-user legal-hold target scoping failed';
  end if;
  if not public.governance_target_has_active_legal_hold('private_asset','same-object','10000000-0000-4000-8000-000000000002')
     or not public.governance_target_has_active_legal_hold('private_asset','same-object','10000000-0000-4000-8000-000000000003')
     or public.governance_target_has_active_legal_hold('private_asset','same-object','10000000-0000-4000-8000-000000000004') then
    raise exception 'active legal-hold subject lookup mismatch';
  end if;
  begin
    update public.governance_legal_hold_targets set preservation_scope='tampered' where hold_id=:'active_hold_id'::uuid;
    raise exception 'expected legal-hold target update rejection';
  exception when others then
    if sqlerrm <> 'GOVERNANCE_RECORD_IMMUTABLE' then raise; end if;
  end;
end
$$;

select public.release_governance_legal_hold(
  :'active_hold_id'::uuid,'10000000-0000-4000-8000-000000000001','release after preservation need ended',
  statement_timestamp(),'totp','40000000-0000-4000-8000-000000000004','release_key_0001'
) as released_hold_id \gset

do $$
begin
  if public.governance_target_has_active_legal_hold('private_asset','same-object','10000000-0000-4000-8000-000000000002') then
    raise exception 'released legal hold still blocks target';
  end if;
end
$$;

select public.open_governance_legal_hold(
  '10000000-0000-4000-8000-000000000001','investigation','expiry behavior test',null,
  statement_timestamp()+interval '1 day',statement_timestamp()+interval '2 days',statement_timestamp(),'totp',
  'legal-hold-v1','[{"target_type":"private_asset","target_id":"expiring-object","subject_user_id":"10000000-0000-4000-8000-000000000002","preservation_scope":"metadata_only"}]'::jsonb,
  '40000000-0000-4000-8000-000000000005','hold_key_0004'
) as expiring_hold_id \gset

update public.governance_legal_holds set status='expired', updated_at=statement_timestamp() where id=:'expiring_hold_id'::uuid;

do $$
begin
  if public.governance_target_has_active_legal_hold('private_asset','expiring-object','10000000-0000-4000-8000-000000000002') then
    raise exception 'expired legal hold still blocks target';
  end if;
end
$$;

-- Retention-policy rows are immutable too.
do $$
begin
  begin
    update public.retention_policy_versions set purge_mode='manual_only' where policy_key='private_generation_asset_trash';
    raise exception 'expected retention-policy update rejection';
  exception when others then
    if sqlerrm <> 'GOVERNANCE_RECORD_IMMUTABLE' then raise; end if;
  end;
end
$$;
