-- Gate 21C-1 local PostgreSQL integration. Fixed fixture identifiers are never emitted.

create or replace function pg_temp.assert_true(value boolean, label text)
returns void language plpgsql as $$
begin
  if value is not true then raise exception 'ASSERTION_FAILED:%', label; end if;
end $$;

create or replace function pg_temp.expect_error(label text, expected text, statement text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
    raise exception 'EXPECTED_ERROR_NOT_RAISED:%', label;
  exception when others then
    if position(expected in sqlerrm)=0 then raise exception 'UNEXPECTED_ERROR:%', label; end if;
  end;
end $$;

create or replace function pg_temp.public_execute_granted(signature regprocedure)
returns boolean language sql stable as $$
  select exists(
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where p.oid=signature and acl.grantee=0 and acl.privilege_type='EXECUTE'
  )
$$;

-- Signatures, privilege boundaries, ordering, locking, and untouched scheduler RPC definitions.
do $$
declare
  package_signature regprocedure := 'public.creator_publishing_save_content_package(uuid,text,uuid,uuid,text,text,boolean,text,text,timestamptz,text)'::regprocedure;
  plan_signature regprocedure := 'public.creator_publishing_create_autopost_plan(uuid,uuid[],text)'::regprocedure;
  package_def text := pg_get_functiondef(package_signature);
  plan_def text := pg_get_functiondef(plan_signature);
begin
  perform pg_temp.assert_true(position('security definer' in lower(package_def))>0,'package security definer');
  perform pg_temp.assert_true(position('set search_path to ''public'', ''pg_temp''' in lower(package_def))>0,'package search path');
  perform pg_temp.assert_true(position('select * into v_existing_audit' in lower(package_def))<position('select * into v_account' in lower(package_def)),'package replay ordering');
  perform pg_temp.assert_true(position('for update' in lower(package_def))>0,'package account lock');
  perform pg_temp.assert_true(position('DESTINATION_ACCOUNT_NOT_VERIFIED' in package_def)>0,'package verified guard');
  perform pg_temp.assert_true(position('PLATFORM_ACCOUNT_REVOKED' in package_def)>0,'package revoked guard');

  perform pg_temp.assert_true(position('security definer' in lower(plan_def))>0,'plan security definer');
  perform pg_temp.assert_true(position('set search_path to ''public'', ''pg_temp''' in lower(plan_def))>0,'plan search path');
  perform pg_temp.assert_true(position('autopost_locked_destination_accounts' in plan_def)>0,'plan account lock table');
  perform pg_temp.assert_true(position('order by a.id for update' in lower(plan_def))>0,'plan deterministic account lock');
  perform pg_temp.assert_true(position('select * into v_existing from public.creator_publishing_plans' in lower(plan_def))<position('only genuinely new requests perform business-validation' in lower(plan_def)),'plan replay ordering');
  perform pg_temp.assert_true(position('DESTINATION_ACCOUNT_NOT_VERIFIED' in plan_def)>0,'plan verified guard');
  perform pg_temp.assert_true(position('DESTINATION_ACCOUNT_REVOKED' in plan_def)>0,'plan revoked guard');
  perform pg_temp.assert_true(position('insert into public.creator_publishing_scheduler_events' in lower(plan_def))=0,'plan creates no scheduler events');

  perform pg_temp.assert_true(not pg_temp.public_execute_granted(package_signature),'public package execute revoked');
  perform pg_temp.assert_true(not has_function_privilege('anon',package_signature,'execute'),'anon package execute revoked');
  perform pg_temp.assert_true(not has_function_privilege('authenticated',package_signature,'execute'),'authenticated package execute revoked');
  perform pg_temp.assert_true(has_function_privilege('service_role',package_signature,'execute'),'service package execute granted');
  perform pg_temp.assert_true(not pg_temp.public_execute_granted(plan_signature),'public plan execute revoked');
  perform pg_temp.assert_true(not has_function_privilege('anon',plan_signature,'execute'),'anon plan execute revoked');
  perform pg_temp.assert_true(not has_function_privilege('authenticated',plan_signature,'execute'),'authenticated plan execute revoked');
  perform pg_temp.assert_true(has_function_privilege('service_role',plan_signature,'execute'),'service plan execute granted');

  perform pg_temp.assert_true(pg_get_functiondef('public.creator_publishing_schedule_plan(uuid,uuid,timestamptz,text,text,text,text,uuid[],jsonb,text)'::regprocedure)=(select definition from public.task21_scheduler_function_snapshot where signature='creator_publishing_schedule_plan'),'schedule unchanged');
  perform pg_temp.assert_true(pg_get_functiondef('public.creator_publishing_process_scheduler_event(uuid,uuid,text,text)'::regprocedure)=(select definition from public.task21_scheduler_function_snapshot where signature='creator_publishing_process_scheduler_event'),'process unchanged');
  perform pg_temp.assert_true(pg_get_functiondef('public.creator_publishing_claim_due_scheduler_events(integer,integer)'::regprocedure)=(select definition from public.task21_scheduler_function_snapshot where signature='creator_publishing_claim_due_scheduler_events'),'claim unchanged');
  perform pg_temp.assert_true(pg_get_functiondef('public.creator_publishing_cancel_plan_schedule(uuid,uuid,text,text)'::regprocedure)=(select definition from public.task21_scheduler_function_snapshot where signature='creator_publishing_cancel_plan_schedule'),'cancel unchanged');
end $$;

-- 01800 must not backfill or mutate pre-existing records.
do $$
begin
  perform pg_temp.assert_true(not exists(
    with current_rows as (
      select 'account'::text entity_type,id,to_jsonb(a) row_data from public.creator_platform_accounts a
      union all select 'package',id,to_jsonb(p) from public.creator_publishing_content_packages p
      union all select 'media',id,to_jsonb(m) from public.creator_publishing_media_assets m
    ) select * from public.task21_verified_destination_snapshot except select * from current_rows
  ),'historical rows preserved');
  perform pg_temp.assert_true(not exists(
    with current_rows as (
      select 'account'::text entity_type,id,to_jsonb(a) row_data from public.creator_platform_accounts a
      union all select 'package',id,to_jsonb(p) from public.creator_publishing_content_packages p
      union all select 'media',id,to_jsonb(m) from public.creator_publishing_media_assets m
    ) select * from current_rows except select * from public.task21_verified_destination_snapshot
  ),'no historical account package media additions');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_plans)=0,'no migration plan');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_platform_jobs)=0,'no migration job');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_scheduler_events)=0,'no migration event');
end $$;

-- Package create rejects every nonverified state without package or audit residue.
select pg_temp.expect_error('unattested package','DESTINATION_ACCOUNT_NOT_VERIFIED',$q$select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','create',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Unattested should fail','caption',false,null,null,null,'pkg_unattested_01')$q$);
select pg_temp.expect_error('attested package','DESTINATION_ACCOUNT_NOT_VERIFIED',$q$select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','create',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Attested should fail','caption',false,null,null,null,'pkg_attested_001')$q$);
select pg_temp.expect_error('revoked package','PLATFORM_ACCOUNT_REVOKED',$q$select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','create',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','Revoked should fail','caption',false,null,null,null,'pkg_revoked_0001')$q$);
do $$ begin
  perform pg_temp.assert_true(not exists(select 1 from public.creator_publishing_content_packages where title like '%should fail'),'failed package rows absent');
  perform pg_temp.assert_true(not exists(select 1 from public.creator_publishing_audit_events where idempotency_key in ('pkg_unattested_01','pkg_attested_001','pkg_revoked_0001')),'failed package audits absent');
end $$;

-- Verified package succeeds. Exact replay remains valid after later status downgrade.
create temp table task21_package_create as select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','create',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','Verified created package','verified caption',false,'price','visibility',null,'pkg_verified_001') result;
do $$ begin
  perform pg_temp.assert_true((select result->>'outcome' from task21_package_create)='created','verified package created');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_audit_events where idempotency_key='pkg_verified_001')=1,'verified package audit');
end $$;
update public.creator_platform_accounts set verification_status='creator_attested',verification_reviewed_by=null,verification_reviewed_at=null,verification_evidence_reference=null,verification_reason=null,verification_legacy_revoked=false,verification_attested_at=coalesce(verification_attested_at,clock_timestamp()) where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
create temp table task21_package_replay as select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','create',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','Verified created package','verified caption',false,'price','visibility',null,'pkg_verified_001') result;
do $$ begin
  perform pg_temp.assert_true((select result->>'outcome' from task21_package_replay)='idempotent','package exact replay');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_audit_events where idempotency_key='pkg_verified_001')=1,'package replay no audit');
end $$;
select pg_temp.expect_error('changed package replay','IDEMPOTENCY_CONFLICT',$q$select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','create',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','Changed replay','verified caption',false,'price','visibility',null,'pkg_verified_001')$q$);
update public.creator_platform_accounts set verification_status='verified',verification_reviewed_by='22222222-2222-4222-8222-222222222222',verification_reviewed_at=clock_timestamp(),verification_evidence_reference='fixture://verified-4-restored',verification_reason='verified fixture restored',verification_legacy_revoked=false,verification_attested_at=coalesce(verification_attested_at,clock_timestamp()) where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';

-- Destination changes to nonverified accounts preserve every package field and create no audit.
do $$
declare before_row jsonb; after_row jsonb; expected_at timestamptz;
begin
  select to_jsonb(p),p.updated_at into before_row,expected_at from public.creator_publishing_content_packages p where id='cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
  perform pg_temp.expect_error('update unattested','DESTINATION_ACCOUNT_NOT_VERIFIED',format($q$select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','update','cccccccc-cccc-4ccc-8ccc-ccccccccccc2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Verified package','verified',false,null,null,'%s','upd_unattested_01')$q$,expected_at));
  select to_jsonb(p) into after_row from public.creator_publishing_content_packages p where id='cccccccc-cccc-4ccc-8ccc-ccccccccccc2'; perform pg_temp.assert_true(after_row=before_row,'unattested update atomic');
  perform pg_temp.expect_error('update attested','DESTINATION_ACCOUNT_NOT_VERIFIED',format($q$select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','update','cccccccc-cccc-4ccc-8ccc-ccccccccccc2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Verified package','verified',false,null,null,'%s','upd_attested_0001')$q$,expected_at));
  select to_jsonb(p) into after_row from public.creator_publishing_content_packages p where id='cccccccc-cccc-4ccc-8ccc-ccccccccccc2'; perform pg_temp.assert_true(after_row=before_row,'attested update atomic');
  perform pg_temp.expect_error('update revoked','PLATFORM_ACCOUNT_REVOKED',format($q$select public.creator_publishing_save_content_package('11111111-1111-4111-8111-111111111111','update','cccccccc-cccc-4ccc-8ccc-ccccccccccc2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','Verified package','verified',false,null,null,'%s','upd_revoked_00001')$q$,expected_at));
  select to_jsonb(p) into after_row from public.creator_publishing_content_packages p where id='cccccccc-cccc-4ccc-8ccc-ccccccccccc2'; perform pg_temp.assert_true(after_row=before_row,'revoked update atomic');
  perform pg_temp.assert_true(not exists(select 1 from public.creator_publishing_audit_events where idempotency_key in ('upd_unattested_01','upd_attested_0001','upd_revoked_00001')),'failed update audits absent');
end $$;

-- Nonverified, revoked, and mixed plan requests fail atomically before plan, job, event, or audit creation.
select pg_temp.expect_error('attested plan','DESTINATION_ACCOUNT_NOT_VERIFIED',$q$select public.creator_publishing_create_autopost_plan('11111111-1111-4111-8111-111111111111',array['cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid],'plan_attested_001')$q$);
select pg_temp.expect_error('mixed plan','DESTINATION_ACCOUNT_NOT_VERIFIED',$q$select public.creator_publishing_create_autopost_plan('11111111-1111-4111-8111-111111111111',array['cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid,'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'::uuid],'plan_mixed_00001')$q$);
update public.creator_publishing_content_packages set platform_account_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',updated_at=clock_timestamp() where id='cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
select pg_temp.expect_error('revoked plan','DESTINATION_ACCOUNT_REVOKED',$q$select public.creator_publishing_create_autopost_plan('11111111-1111-4111-8111-111111111111',array['cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid],'plan_revoked_0001')$q$);
update public.creator_publishing_content_packages set platform_account_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',updated_at=clock_timestamp() where id='cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
do $$ begin
  perform pg_temp.assert_true(not exists(select 1 from public.creator_publishing_plans where idempotency_key in ('plan_attested_001','plan_mixed_00001','plan_revoked_0001')),'nonverified plans absent');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_platform_jobs)=0,'nonverified jobs absent');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_scheduler_events)=0,'nonverified events absent');
  perform pg_temp.assert_true(not exists(select 1 from public.creator_publishing_audit_events where idempotency_key in ('plan_attested_001','plan_mixed_00001','plan_revoked_0001')),'nonverified plan audits absent');
end $$;

-- Verified plan creates one draft job and no scheduler event.
create temp table task21_plan_create as select public.creator_publishing_create_autopost_plan('11111111-1111-4111-8111-111111111111',array['cccccccc-cccc-4ccc-8ccc-ccccccccccc4'::uuid],'plan_verified_001') result;
do $$ declare plan_id uuid := ((select result from task21_plan_create)->'plan'->>'id')::uuid; begin
  perform pg_temp.assert_true((select result->'plan'->>'status' from task21_plan_create)='draft','verified plan draft');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_platform_jobs where publishing_plan_id=plan_id and job_state='draft')=1,'verified draft job');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_scheduler_events where publishing_plan_id=plan_id)=0,'verified plan no events');
end $$;

-- Exact plan replay remains valid after downgrade; changed input with the same key conflicts first.
update public.creator_platform_accounts set verification_status='creator_attested',verification_reviewed_by=null,verification_reviewed_at=null,verification_evidence_reference=null,verification_reason=null,verification_legacy_revoked=false,verification_attested_at=coalesce(verification_attested_at,clock_timestamp()) where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';
create temp table task21_plan_replay as select public.creator_publishing_create_autopost_plan('11111111-1111-4111-8111-111111111111',array['cccccccc-cccc-4ccc-8ccc-ccccccccccc4'::uuid],'plan_verified_001') result;
do $$ begin
  perform pg_temp.assert_true((select (result->>'idempotent')::boolean from task21_plan_replay),'plan exact replay');
  perform pg_temp.assert_true((select count(*) from public.creator_publishing_plans where idempotency_key='plan_verified_001')=1,'plan replay no duplicate');
end $$;
select pg_temp.expect_error('changed plan replay','IDEMPOTENCY_CONFLICT',$q$select public.creator_publishing_create_autopost_plan('11111111-1111-4111-8111-111111111111',array['cccccccc-cccc-4ccc-8ccc-ccccccccccc3'::uuid],'plan_verified_001')$q$);

-- Untouched scheduling and processing functions independently retain exact verified-state guards.
do $$
declare
  schedule_def text := replace(pg_get_functiondef('public.creator_publishing_schedule_plan(uuid,uuid,timestamptz,text,text,text,text,uuid[],jsonb,text)'::regprocedure),' ','');
  process_def text := replace(pg_get_functiondef('public.creator_publishing_process_scheduler_event(uuid,uuid,text,text)'::regprocedure),' ','');
begin
  perform pg_temp.assert_true(position('verification_status=''verified''' in schedule_def)>0,'schedule verified guard');
  perform pg_temp.assert_true(position('verification_status=''verified''' in process_def)>0,'process verified guard');
  perform pg_temp.assert_true(position('DESTINATION_ACCOUNT_NOT_VERIFIED' in schedule_def)>0,'schedule verification code');
  perform pg_temp.assert_true(position('DESTINATION_ACCOUNT_NOT_VERIFIED' in process_def)>0,'process verification code');
  perform pg_temp.assert_true(position('DESTINATION_ACCOUNT_REVOKED' in schedule_def)>0,'schedule revoked code');
  perform pg_temp.assert_true(position('DESTINATION_ACCOUNT_REVOKED' in process_def)>0,'process revoked code');
end $$;

select 'TASK21_VERIFIED_DESTINATION_ASSERTIONS_PASSED' result;
