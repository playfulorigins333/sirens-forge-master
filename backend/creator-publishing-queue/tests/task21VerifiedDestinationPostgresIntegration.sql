-- Sanitized Gate 21C-1 integration assertions. Fixture identifiers are fixed local-only values and are not printed.

create or replace function pg_temp.expect_error(p_label text, p_expected text, p_statement text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_statement;
    raise exception 'EXPECTED_ERROR_NOT_RAISED:%', p_label;
  exception when others then
    if position(p_expected in sqlerrm) = 0 then
      raise exception 'UNEXPECTED_ERROR:%', p_label;
    end if;
  end;
end;
$$;

create or replace function pg_temp.assert_true(p_condition boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if p_condition is not true then
    raise exception 'ASSERTION_FAILED:%', p_label;
  end if;
end;
$$;

-- Exact signatures, privilege boundaries, limited override scope, and authoritative source contracts.
do $$
declare
  package_def text := pg_get_functiondef('public.creator_publishing_save_content_package(uuid,text,uuid,uuid,text,text,boolean,text,text,timestamptz,text)'::regprocedure);
  plan_def text := pg_get_functiondef('public.creator_publishing_create_autopost_plan(uuid,uuid[],text)'::regprocedure);
  scheduler_row record;
begin
  perform pg_temp.assert_true(package_def is not null, 'package rpc missing');
  perform pg_temp.assert_true(plan_def is not null, 'plan rpc missing');

  perform pg_temp.assert_true(position('security definer' in lower(package_def)) > 0, 'package rpc security definer');
  perform pg_temp.assert_true(position('set search_path to ''public'', ''pg_temp''' in lower(package_def)) > 0, 'package rpc search path');
  perform pg_temp.assert_true(position('for update' in lower(package_def)) > 0, 'package account row lock');
  perform pg_temp.assert_true(position('DESTINATION_ACCOUNT_NOT_VERIFIED' in package_def) > 0, 'package verified guard');
  perform pg_temp.assert_true(position('PLATFORM_ACCOUNT_REVOKED' in package_def) > 0, 'package revoked guard');
  perform pg_temp.assert_true(position('select * into v_existing_audit' in lower(package_def)) < position('select * into v_account' in lower(package_def)), 'package exact replay precedes account validation');

  perform pg_temp.assert_true(position('security definer' in lower(plan_def)) > 0, 'plan rpc security definer');
  perform pg_temp.assert_true(position('set search_path to ''public'', ''pg_temp''' in lower(plan_def)) > 0, 'plan rpc search path');
  perform pg_temp.assert_true(position('autopost_locked_destination_accounts' in plan_def) > 0, 'plan destination account lock table');
  perform pg_temp.assert_true(position('order by a.id for update' in lower(plan_def)) > 0, 'plan deterministic destination lock');
  perform pg_temp.assert_true(position('DESTINATION_ACCOUNT_NOT_VERIFIED' in plan_def) > 0, 'plan verified guard');
  perform pg_temp.assert_true(position('DESTINATION_ACCOUNT_REVOKED' in plan_def) > 0, 'plan revoked guard');
  perform pg_temp.assert_true(position('select * into v_existing from public.creator_publishing_plans' in lower(plan_def)) < position('only genuinely new requests perform business-validation' in lower(plan_def)), 'plan exact replay precedes business validation');
  perform pg_temp.assert_true(position('insert into public.creator_publishing_scheduler_events' in lower(plan_def)) = 0, 'plan rpc creates no scheduler events');

  perform pg_temp.assert_true(not has_function_privilege('public', 'public.creator_publishing_save_content_package(uuid,text,uuid,uuid,text,text,boolean,text,text,timestamptz,text)', 'execute'), 'public package execute revoked');
  perform pg_temp.assert_true(not has_function_privilege('anon', 'public.creator_publishing_save_content_package(uuid,text,uuid,uuid,text,text,boolean,text,text,timestamptz,text)', 'execute'), 'anon package execute revoked');
  perform pg_temp.assert_true(not has_function_privilege('authenticated', 'public.creator_publishing_save_content_package(uuid,text,uuid,uuid,text,text,boolean,text,text,timestamptz,text)', 'execute'), 'authenticated package execute revoked');
  perform pg_temp.assert_true(has_function_privilege('service_role', 'public.creator_publishing_save_content_package(uuid,text,uuid,uuid,text,text,boolean,text,text,timestamptz,text)', 'execute'), 'service package execute granted');
  perform pg_temp.assert_true(not has_function_privilege('public', 'public.creator_publishing_create_autopost_plan(uuid,uuid[],text)', 'execute'), 'public plan execute revoked');
  perform pg_temp.assert_true(not has_function_privilege('anon', 'public.creator_publishing_create_autopost_plan(uuid,uuid[],text)', 'execute'), 'anon plan execute revoked');
  perform pg_temp.assert_true(not has_function_privilege('authenticated', 'public.creator_publishing_create_autopost_plan(uuid,uuid[],text)', 'execute'), 'authenticated plan execute revoked');
  perform pg_temp.assert_true(has_function_privilege('service_role', 'public.creator_publishing_create_autopost_plan(uuid,uuid[],text)', 'execute'), 'service plan execute granted');

  for scheduler_row in select signature, definition from public.task21_scheduler_function_snapshot loop
    if scheduler_row.signature = 'creator_publishing_schedule_plan' then
      perform pg_temp.assert_true(pg_get_functiondef('public.creator_publishing_schedule_plan(uuid,uuid,timestamptz,text,text,text,text,uuid[],jsonb,text)'::regprocedure) = scheduler_row.definition, 'schedule rpc unchanged');
    elsif scheduler_row.signature = 'creator_publishing_process_scheduler_event' then
      perform pg_temp.assert_true(pg_get_functiondef('public.creator_publishing_process_scheduler_event(uuid,uuid,text,text)'::regprocedure) = scheduler_row.definition, 'process rpc unchanged');
    elsif scheduler_row.signature = 'creator_publishing_claim_due_scheduler_events' then
      perform pg_temp.assert_true(pg_get_functiondef('public.creator_publishing_claim_due_scheduler_events(integer,integer)'::regprocedure) = scheduler_row.definition, 'claim rpc unchanged');
    elsif scheduler_row.signature = 'creator_publishing_cancel_plan_schedule' then
      perform pg_temp.assert_true(pg_get_functiondef('public.creator_publishing_cancel_plan_schedule(uuid,uuid,text,text)'::regprocedure) = scheduler_row.definition, 'cancel rpc unchanged');
    else
      raise exception 'UNKNOWN_SCHEDULER_SNAPSHOT';
    end if;
  end loop;
end;
$$;

-- Migration 01800 must not mutate any pre-existing account, package, or media record.
do $$
begin
  perform pg_temp.assert_true(not exists(
    (select entity_type,id,row_data from public.task21_verified_destination_snapshot
     except
     select 'account',id,to_jsonb(a) from public.creator_platform_accounts a
     union all
     select 'package',id,to_jsonb(p) from public.creator_publishing_content_packages p
     union all
     select 'media',id,to_jsonb(m) from public.creator_publishing_media_assets m)
  ), 'historical snapshot rows still exist unchanged');
  perform pg_temp.assert_true(not exists(
    (select 'account'::text entity_type,id,to_jsonb(a) row_data from public.creator_platform_accounts a
     union all
     select 'package',id,to_jsonb(p) from public.creator_publishing_content_packages p
     union all
     select 'media',id,to_jsonb(m) from public.creator_publishing_media_assets m)
    except
    select entity_type,id,row_data from public.task21_verified_destination_snapshot
  ), 'migration introduced no account package or media rows');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_plans) = 0, 'migration created no plan');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_platform_jobs) = 0, 'migration created no job');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_scheduler_events) = 0, 'migration created no scheduler event');
end;
$$;

-- Nonverified package creation must fail without package or audit residue.
select pg_temp.expect_error('unattested package create','DESTINATION_ACCOUNT_NOT_VERIFIED',$sql$
  select public.creator_publishing_save_content_package(
    '11111111-1111-4111-8111-111111111111','create',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'Unattested should fail','caption',false,null,null,null,'pkg_unattested_01')
$sql$);
select pg_temp.expect_error('attested package create','DESTINATION_ACCOUNT_NOT_VERIFIED',$sql$
  select public.creator_publishing_save_content_package(
    '11111111-1111-4111-8111-111111111111','create',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    'Attested should fail','caption',false,null,null,null,'pkg_attested_001')
$sql$);
select pg_temp.expect_error('revoked package create','PLATFORM_ACCOUNT_REVOKED',$sql$
  select public.creator_publishing_save_content_package(
    '11111111-1111-4111-8111-111111111111','create',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    'Revoked should fail','caption',false,null,null,null,'pkg_revoked_0001')
$sql$);

do $$
begin
  perform pg_temp.assert_true(not exists(select 1 from public.creator_publishing_content_packages where title in ('Unattested should fail','Attested should fail','Revoked should fail')), 'failed package creates left no rows');
  perform pg_temp.assert_true(not exists(select 1 from public.creator_publishing_audit_events where idempotency_key in ('pkg_unattested_01','pkg_attested_001','pkg_revoked_0001')), 'failed package creates left no audits');
end;
$$;

-- Verified package creation succeeds and exact replay remains safe after later account downgrade.
create temp table task21_created_package as
select public.creator_publishing_save_content_package(
  '11111111-1111-4111-8111-111111111111','create',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  'Verified created package','verified caption',false,'price','visibility',null,'pkg_verified_001') as result;

do $$
declare
  created_id uuid := ((select result from task21_created_package)->'package'->>'id')::uuid;
  before_count bigint;
  replay jsonb;
begin
  perform pg_temp.assert_true(created_id is not null, 'verified package created');
  perform pg_temp.assert_true((select result->>'outcome' from task21_created_package) = 'created', 'verified package create outcome');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_audit_events where idempotency_key='pkg_verified_001') = 1, 'verified package one audit');
  select count(*) into before_count from public.creator_publishing_content_packages;

  update public.creator_platform_accounts
    set verification_status='creator_attested', verification_reviewed_by=null, verification_reviewed_at=null,
        verification_evidence_reference=null, verification_reason=null, verification_legacy_revoked=false,
        verification_attested_at=coalesce(verification_attested_at,clock_timestamp())
    where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';

  select public.creator_publishing_save_content_package(
    '11111111-1111-4111-8111-111111111111','create',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
    'Verified created package','verified caption',false,'price','visibility',null,'pkg_verified_001') into replay;
  perform pg_temp.assert_true(replay->>'outcome'='idempotent' and (replay->>'idempotent')::boolean, 'package exact replay after downgrade');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_content_packages)=before_count, 'package replay created no duplicate');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_audit_events where idempotency_key='pkg_verified_001')=1, 'package replay created no audit');

  perform pg_temp.expect_error('changed package replay','IDEMPOTENCY_CONFLICT',format($q$
    select public.creator_publishing_save_content_package(
      '11111111-1111-4111-8111-111111111111','create',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
      'Changed replay title','verified caption',false,'price','visibility',null,'pkg_verified_001')
  $q$));
end;
$$;

-- Restore verified status for later update and plan tests.
update public.creator_platform_accounts
set verification_status='verified', verification_reviewed_by='22222222-2222-4222-8222-222222222222',
    verification_reviewed_at=clock_timestamp(), verification_evidence_reference='fixture://verified-4-restored',
    verification_reason='verified fixture restored', verification_legacy_revoked=false,
    verification_attested_at=coalesce(verification_attested_at,clock_timestamp())
where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';

-- Destination changes to each nonverified status fail atomically and preserve the package and updated_at.
do $$
declare
  package_before jsonb;
  package_after jsonb;
  package_updated_at timestamptz;
  target_id uuid := 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
begin
  select to_jsonb(p),p.updated_at into package_before,package_updated_at from public.creator_publishing_content_packages p where p.id=target_id;

  perform pg_temp.expect_error('update to unattested','DESTINATION_ACCOUNT_NOT_VERIFIED',format($q$
    select public.creator_publishing_save_content_package(
      '11111111-1111-4111-8111-111111111111','update','%s','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'Verified package','verified',false,null,null,'%s','upd_unattested_01')
  $q$,target_id,package_updated_at));
  select to_jsonb(p) into package_after from public.creator_publishing_content_packages p where p.id=target_id;
  perform pg_temp.assert_true(package_after=package_before, 'unattested destination update atomic');

  perform pg_temp.expect_error('update to attested','DESTINATION_ACCOUNT_NOT_VERIFIED',format($q$
    select public.creator_publishing_save_content_package(
      '11111111-1111-4111-8111-111111111111','update','%s','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      'Verified package','verified',false,null,null,'%s','upd_attested_0001')
  $q$,target_id,package_updated_at));
  select to_jsonb(p) into package_after from public.creator_publishing_content_packages p where p.id=target_id;
  perform pg_temp.assert_true(package_after=package_before, 'attested destination update atomic');

  perform pg_temp.expect_error('update to revoked','PLATFORM_ACCOUNT_REVOKED',format($q$
    select public.creator_publishing_save_content_package(
      '11111111-1111-4111-8111-111111111111','update','%s','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'Verified package','verified',false,null,null,'%s','upd_revoked_00001')
  $q$,target_id,package_updated_at));
  select to_jsonb(p) into package_after from public.creator_publishing_content_packages p where p.id=target_id;
  perform pg_temp.assert_true(package_after=package_before, 'revoked destination update atomic');
  perform pg_temp.assert_true(not exists(select 1 from public.creator_publishing_audit_events where idempotency_key in ('upd_unattested_01','upd_attested_0001','upd_revoked_00001')), 'failed updates left no audits');
end;
$$;

-- Nonverified plan creation, including a mixed multi-package request, must leave no partial state.
select pg_temp.expect_error('attested plan','DESTINATION_ACCOUNT_NOT_VERIFIED',$sql$
  select public.creator_publishing_create_autopost_plan(
    '11111111-1111-4111-8111-111111111111',array['cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid],'plan_attested_001')
$sql$);
select pg_temp.expect_error('mixed plan','DESTINATION_ACCOUNT_NOT_VERIFIED',$sql$
  select public.creator_publishing_create_autopost_plan(
    '11111111-1111-4111-8111-111111111111',array['cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid,'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'::uuid],'plan_mixed_00001')
$sql$);

do $$
begin
  perform pg_temp.assert_true(not exists(select 1 from public.creator_publishing_plans where idempotency_key in ('plan_attested_001','plan_mixed_00001')), 'nonverified plans absent');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_platform_jobs)=0, 'nonverified plan jobs absent');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_scheduler_events)=0, 'nonverified plan scheduler events absent');
  perform pg_temp.assert_true(not exists(select 1 from public.creator_publishing_audit_events where idempotency_key in ('plan_attested_001','plan_mixed_00001')), 'nonverified plan audits absent');
end;
$$;

-- Revoked plan creation returns the specific safe state and leaves no residue.
update public.creator_publishing_content_packages
set platform_account_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', updated_at=clock_timestamp()
where id='cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
select pg_temp.expect_error('revoked plan','DESTINATION_ACCOUNT_REVOKED',$sql$
  select public.creator_publishing_create_autopost_plan(
    '11111111-1111-4111-8111-111111111111',array['cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid],'plan_revoked_0001')
$sql$);
update public.creator_publishing_content_packages
set platform_account_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', updated_at=clock_timestamp()
where id='cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

do $$
begin
  perform pg_temp.assert_true(not exists(select 1 from public.creator_publishing_plans where idempotency_key='plan_revoked_0001'), 'revoked plan absent');
  perform pg_temp.assert_true(not exists(select 1 from public.creator_publishing_audit_events where idempotency_key='plan_revoked_0001'), 'revoked plan audit absent');
end;
$$;

-- Verified plan creation succeeds as draft-only, creates no scheduler event, and exact replay survives a later account downgrade.
create temp table task21_created_plan as
select public.creator_publishing_create_autopost_plan(
  '11111111-1111-4111-8111-111111111111',array['cccccccc-cccc-4ccc-8ccc-ccccccccccc4'::uuid],'plan_verified_001') as result;

do $$
declare
  plan_id uuid := ((select result from task21_created_plan)->'plan'->>'id')::uuid;
  job_count bigint;
  audit_count bigint;
  replay jsonb;
begin
  perform pg_temp.assert_true(plan_id is not null, 'verified plan created');
  perform pg_temp.assert_true((select result->'plan'->>'status' from task21_created_plan)='draft', 'verified plan remains draft');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_platform_jobs where publishing_plan_id=plan_id and job_state='draft')=1, 'verified plan one draft job');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_scheduler_events where publishing_plan_id=plan_id)=0, 'verified plan no scheduler event');
  select count(*) into job_count from public.creator_publishing_platform_jobs;
  select count(*) into audit_count from public.creator_publishing_audit_events where idempotency_key='plan_verified_001';

  update public.creator_platform_accounts
    set verification_status='creator_attested', verification_reviewed_by=null, verification_reviewed_at=null,
        verification_evidence_reference=null, verification_reason=null, verification_legacy_revoked=false,
        verification_attested_at=coalesce(verification_attested_at,clock_timestamp())
    where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';

  select public.creator_publishing_create_autopost_plan(
    '11111111-1111-4111-8111-111111111111',array['cccccccc-cccc-4ccc-8ccc-ccccccccccc4'::uuid],'plan_verified_001') into replay;
  perform pg_temp.assert_true((replay->>'idempotent')::boolean, 'plan exact replay after downgrade');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_platform_jobs)=job_count, 'plan replay created no job');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_audit_events where idempotency_key='plan_verified_001')=audit_count, 'plan replay created no audit');

  perform pg_temp.expect_error('changed plan replay','IDEMPOTENCY_CONFLICT',$q$
    select public.creator_publishing_create_autopost_plan(
      '11111111-1111-4111-8111-111111111111',array['cccccccc-cccc-4ccc-8ccc-ccccccccccc3'::uuid],'plan_verified_001')
  $q$);
end;
$$;

-- Scheduling and processing independently retain exact verified-account guards in the untouched functions.
do $$
declare
  schedule_def text := pg_get_functiondef('public.creator_publishing_schedule_plan(uuid,uuid,timestamptz,text,text,text,text,uuid[],jsonb,text)'::regprocedure);
  process_def text := pg_get_functiondef('public.creator_publishing_process_scheduler_event(uuid,uuid,text,text)'::regprocedure);
begin
  perform pg_temp.assert_true(position("verification_status='verified'" in replace(schedule_def,' ','')) > 0, 'schedule independently requires verified');
  perform pg_temp.assert_true(position("verification_status='verified'" in replace(process_def,' ','')) > 0, 'processor independently requires verified');
  perform pg_temp.assert_true(position('DESTINATION_ACCOUNT_NOT_VERIFIED' in schedule_def) > 0, 'schedule safe verification code');
  perform pg_temp.assert_true(position('DESTINATION_ACCOUNT_NOT_VERIFIED' in process_def) > 0, 'processor safe verification code');
  perform pg_temp.assert_true(position('DESTINATION_ACCOUNT_REVOKED' in schedule_def) > 0, 'schedule revoked code');
  perform pg_temp.assert_true(position('DESTINATION_ACCOUNT_REVOKED' in process_def) > 0, 'processor revoked code');
end;
$$;

select 'TASK21_VERIFIED_DESTINATION_ASSERTIONS_PASSED' as result;
