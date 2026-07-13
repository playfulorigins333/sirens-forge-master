\set ON_ERROR_STOP on
\echo 'Task 15 integration assertions starting'

create or replace function public.task15_assert(p_condition boolean, p_message text)
returns void language plpgsql as $$ begin if not p_condition then raise exception 'ASSERTION_FAILED: %', p_message; end if; end $$;

select public.task15_assert(not public.creator_publishing_queue_jsonb_has_forbidden_credential_key('{"safe":{"nested":[{"caption":"ok"}]}}'::jsonb), 'safe nested json returns false');
select public.task15_assert(public.creator_publishing_queue_jsonb_has_forbidden_credential_key('{"password":"x"}'::jsonb), 'top-level forbidden key returns true');
select public.task15_assert(public.creator_publishing_queue_jsonb_has_forbidden_credential_key('{"safe":{"access_token":"x"}}'::jsonb), 'nested object forbidden key returns true');
select public.task15_assert(public.creator_publishing_queue_jsonb_has_forbidden_credential_key('{"safe":[{"platform_secret":"x"}]}'::jsonb), 'nested array forbidden key returns true');
select public.task15_assert(public.creator_publishing_queue_jsonb_has_forbidden_credential_key(jsonb_build_object(forbidden_key,'x')), 'original forbidden key detected: ' || forbidden_key)
from unnest(array['password','access_token','refresh_token','auth_token','session','session_id','cookie','cookies','two_factor_secret','recovery_code','platform_secret']) as forbidden_key;
select public.task15_assert(not public.creator_publishing_queue_jsonb_has_forbidden_credential_key('{"token":"x","secret":"x","api_key":"x","credential":"x"}'::jsonb), 'new generic keys were not added');

insert into auth.users(id,email) values
('00000000-0000-4000-8000-000000000001','creator@example.test'),
('00000000-0000-4000-8000-000000000002','creator2@example.test')
on conflict do nothing;
insert into public.profiles(id,user_id) values ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001') on conflict do nothing;

insert into public.creator_publishing_creator_verifications(
  creator_id,
  status,
  evidence_reference,
  reason,
  reviewed_by,
  reviewed_at,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-000000000001',
  'verified',
  'fixture',
  'Task 15 scheduler fixture',
  '00000000-0000-4000-8000-000000000001',
  now(),
  now(),
  now()
);
insert into public.creator_publishing_ai_twin_consents(creator_id,status,attestation_version,attestation_text_sha256,granted_at,created_at,updated_at)
values ('00000000-0000-4000-8000-000000000001','granted','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',now(),now(),now());

insert into public.creator_platform_accounts(
  id,
  creator_id,
  platform,
  platform_username,
  verification_status,
  verification_attested_at,
  verification_reviewed_by,
  verification_reviewed_at,
  verification_evidence_reference,
  verification_reason,
  created_at,
  updated_at
)
values
(
  '20000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'onlyfans',
  'only_fixture',
  'verified',
  now(),
  '00000000-0000-4000-8000-000000000001',
  now(),
  'fixture',
  'Task 15 scheduler fixture',
  now(),
  now()
),
(
  '20000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  'onlyfans',
  'only_fixture2',
  'verified',
  now(),
  '00000000-0000-4000-8000-000000000001',
  now(),
  'fixture',
  'Task 15 scheduler fixture',
  now(),
  now()
),
(
  '20000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000001',
  'fansly',
  'fansly_direct',
  'verified',
  now(),
  '00000000-0000-4000-8000-000000000001',
  now(),
  'fixture',
  'Task 15 scheduler fixture',
  now(),
  now()
),
(
  '20000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000001',
  'fansly',
  'fansly_planner',
  'verified',
  now(),
  '00000000-0000-4000-8000-000000000001',
  now(),
  'fixture',
  'Task 15 scheduler fixture',
  now(),
  now()
);

insert into public.creator_publishing_content_packages(id,creator_id,platform_account_id,target_platform,title,caption_body,forced_disclosure_text,ai_flag,ai_detail,compliance_status,compliance_policy_version,creator_approval_status,creator_approved_at,creator_approved_by,created_at,updated_at)
values
('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','onlyfans','pkg1','#AI caption','#AI','ai_generated','{}','pending','unassigned','pending',null,null,now(),now()),
('30000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','onlyfans','pkg2','#AI caption','#AI','ai_generated','{}','pending','unassigned','pending',null,null,now(),now()),
('30000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','fansly','direct pkg','caption',null,'ai_generated','{}','pending','unassigned','pending',null,null,now(),now()),
('30000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004','fansly','planner pkg','caption',null,'ai_generated','{}','pending','unassigned','pending',null,null,now(),now());

insert into public.generations(id,user_id,status,r2_bucket,r2_key,metadata) values
('40000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','completed','bucket','key1','{}'),
('40000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','completed','bucket','key2','{}'),
('40000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','completed','bucket','key3','{}'),
('40000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','completed','bucket','key4','{}');

insert into public.creator_publishing_media_assets(id,content_package_id,storage_key,mime_type,sha256,source,ai_generation_metadata,created_at) values
('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','media/key1','image/png','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','ai_pipeline','{"generation_id":"40000000-0000-4000-8000-000000000001"}',now()),
('50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','media/key2','image/png','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','ai_pipeline','{"generation_id":"40000000-0000-4000-8000-000000000002"}',now()),
('50000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003','media/key3','image/png','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','ai_pipeline','{"generation_id":"40000000-0000-4000-8000-000000000003"}',now()),
('50000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000004','media/key4','image/png','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','ai_pipeline','{"generation_id":"40000000-0000-4000-8000-000000000004"}',now());

insert into public.creator_publishing_compliance_reviews(content_package_id,reviewer_id,outcome,review_source,rule_hits,compliance_policy_version,created_at,review_metadata)
select package_id, null, 'pass', 'automated', '[]'::jsonb, 'policy-v1', now(), '{}'::jsonb
from unnest(array['30000000-0000-4000-8000-000000000001'::uuid,'30000000-0000-4000-8000-000000000002'::uuid,'30000000-0000-4000-8000-000000000003'::uuid,'30000000-0000-4000-8000-000000000004'::uuid]) as package_id;
update public.creator_publishing_content_packages set compliance_status='passed', compliance_policy_version='policy-v1', creator_approval_status='approved', creator_approved_at=now(), creator_approved_by='00000000-0000-4000-8000-000000000001';

insert into public.creator_publishing_queue_tasks(id,content_package_id,creator_id,target_platform,platform_account_id,status,due_at,created_at,updated_at)
values
('60000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','onlyfans','20000000-0000-4000-8000-000000000001','ready_for_handoff',null,now(),now()),
('60000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','onlyfans','20000000-0000-4000-8000-000000000002','ready_for_handoff',null,now(),now());

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='creator_publishing_queue_tasks' and column_name='claim_token') then
    update public.creator_publishing_queue_tasks
    set status='claimed',
        claimed_by='00000000-0000-4000-8000-000000000002',
        claimed_at=now(),
        claim_token='90000000-0000-4000-8000-000000000222',
        claim_expires_at=now()+interval '30 minutes',
        updated_at=now()
    where id='60000000-0000-4000-8000-000000000002';
  else
    update public.creator_publishing_queue_tasks
    set status='claimed', claimed_by='00000000-0000-4000-8000-000000000001', claimed_at=now(), updated_at=now()
    where id='60000000-0000-4000-8000-000000000002';
  end if;
end $$;

insert into public.creator_publishing_plans(id,creator_id,status,idempotency_key,request_fingerprint,registry_version,created_at,updated_at)
values
('70000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','draft','plan-key-0001','1111111111111111111111111111111111111111111111111111111111111111','task14.20260711.001',now(),now()),
('70000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','draft','plan-key-0002','2222222222222222222222222222222222222222222222222222222222222222','task14.20260711.001',now(),now()),
('70000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','draft','plan-key-0003','3333333333333333333333333333333333333333333333333333333333333333','task14.20260711.001',now(),now());

select public.task15_assert(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.creator_publishing_scheduler_idempotency'::regclass
      and conname = 'creator_publishing_scheduler_idempotency_plan_creator_fk'
      and contype = 'f'
  ),
  'scheduler idempotency plan creator foreign key exists'
);
do $$
begin
  begin
    insert into public.creator_publishing_scheduler_idempotency(
      creator_id,
      publishing_plan_id,
      action_type,
      idempotency_key,
      request_fingerprint,
      result,
      created_at
    )
    values (
      '00000000-0000-4000-8000-000000000002',
      '70000000-0000-4000-8000-000000000001',
      'schedule',
      'idempotency-owner-mismatch-key-0001',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '{}'::jsonb,
      now()
    );

    raise exception 'expected scheduler idempotency plan creator foreign key violation';
  exception
    when foreign_key_violation then
      null;
  end;
end
$$;
select public.task15_assert(
  not exists (
    select 1
    from public.creator_publishing_scheduler_idempotency
    where idempotency_key = 'idempotency-owner-mismatch-key-0001'
  ),
  'mismatched scheduler idempotency row is not stored'
);

insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,created_at,updated_at)
values
('80000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','onlyfans','assisted','draft',(select updated_at from public.creator_publishing_content_packages where id='30000000-0000-4000-8000-000000000001'),public.creator_publishing_autopost_source_fingerprint('30000000-0000-4000-8000-000000000001'),'task14.20260711.001','1111111111111111111111111111111111111111111111111111111111111111',now(),now()),
('80000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','onlyfans','assisted','draft',(select updated_at from public.creator_publishing_content_packages where id='30000000-0000-4000-8000-000000000002'),public.creator_publishing_autopost_source_fingerprint('30000000-0000-4000-8000-000000000002'),'task14.20260711.001','1111111111111111111111111111111111111111111111111111111111111111',now(),now());

select public.task15_assert(schedule_revision is null and intended_publish_at is null, 'unscheduled draft revision is null') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
do $$
begin
  begin
    update public.creator_publishing_platform_jobs
    set schedule_revision = 1,
        intended_publish_at = now() + interval '3 hours',
        schedule_timezone = null,
        scheduled_at = now(),
        scheduled_by = '00000000-0000-4000-8000-000000000001'
    where id = '80000000-0000-4000-8000-000000000001';

    raise exception 'expected scheduled timezone constraint violation';
  exception
    when check_violation then
      null;
  end;
end
$$;
select public.task15_assert(job_state='draft' and schedule_revision is null and intended_publish_at is null and schedule_timezone is null and scheduled_at is null and scheduled_by is null, 'scheduled timezone constraint leaves draft untouched') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';

select now() + interval '3 hours' as schedule_intended_publish_at \gset
select public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',:'schedule_intended_publish_at'::timestamptz,'UTC','schedule-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000001'::uuid,'80000000-0000-4000-8000-000000000002'::uuid],'{}','schedule') as schedule_result \gset
select public.task15_assert((:'schedule_result')::jsonb->>'idempotent' = 'false', 'first schedule is not idempotent replay');
select public.task15_assert(((:'schedule_result')::jsonb->>'success_count')::int = 1, 'per-destination isolation lets compatible destination succeed');
select public.task15_assert(((:'schedule_result')::jsonb->>'failure_count')::int = 1, 'per-destination isolation returns failed destination');
select public.task15_assert(schedule_revision=1 and job_state='scheduled_internally' and operator_due_at = intended_publish_at - interval '60 minutes', 'assisted schedule fields set') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert(schedule_revision is null and job_state='draft', 'failed queue-conflict destination not mutated') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000002';
select public.task15_assert(count(*)=2, 'assisted schedule creates two events') from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000001';
select public.task15_assert(not exists(select 1 from public.creator_publishing_queue_tasks where id='60000000-0000-4000-8000-000000000001' and status <> 'ready_for_handoff'), 'queue rows not mutated');

select public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',:'schedule_intended_publish_at'::timestamptz,'UTC','schedule-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000001'::uuid,'80000000-0000-4000-8000-000000000002'::uuid],'{}','schedule') as replay_result \gset
select public.task15_assert((:'replay_result')::jsonb->>'idempotent' = 'true', 'schedule replay reports idempotent true');
select public.task15_assert(((:'replay_result')::jsonb->>'success_count')::int = 1, 'idempotent replay returns stored success count');
select public.task15_assert(((:'replay_result')::jsonb->>'failure_count')::int = 1, 'idempotent replay returns stored failure count');
select public.task15_assert((:'replay_result')::jsonb - 'idempotent' = (:'schedule_result')::jsonb - 'idempotent', 'schedule replay matches original except idempotent flag');
select public.task15_assert((select count(*) from public.creator_publishing_scheduler_idempotency where creator_id='00000000-0000-4000-8000-000000000001' and action_type='schedule' and idempotency_key='schedule-key-0001')=1, 'single schedule idempotency row');
select public.task15_assert((select result->>'idempotent' from public.creator_publishing_scheduler_idempotency where creator_id='00000000-0000-4000-8000-000000000001' and action_type='schedule' and idempotency_key='schedule-key-0001')='false', 'stored schedule result remains non-idempotent');
select public.task15_assert((select count(*) from public.creator_publishing_audit_events where action='creator_publishing_schedule_created' and idempotency_key='schedule-key-0001')=1, 'single schedule-created audit for replay');
select public.task15_assert(schedule_revision=1, 'schedule replay leaves assisted job revision one') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert((select count(*) from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000001' and schedule_revision=1)=2, 'schedule replay creates no duplicate revision one events');

do $$ begin
  begin
    perform public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',now()+interval '4 hours','UTC','schedule-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000001'::uuid],'{}','schedule');
    raise exception 'expected idempotency conflict';
  exception when others then
    if sqlerrm not like '%IDEMPOTENCY_CONFLICT%' then raise; end if;
  end;
end $$;

do $$ begin
  begin
    perform public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',now()+interval '5 hours','UTC','invalid-revision-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000001'::uuid],jsonb_build_object('not-a-uuid',1),'reschedule');
    raise exception 'expected invalid expected revision key';
  exception when others then
    if sqlerrm not like '%SCHEDULER_EXPECTED_REVISIONS_INVALID%' then raise; end if;
  end;
end $$;
select public.task15_assert(schedule_revision=1 and job_state='scheduled_internally', 'invalid expected revision key leaves assisted job unchanged') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert((select count(*) from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000001' and schedule_revision=1)=2, 'invalid expected revision key leaves revision one events unchanged');
select public.task15_assert(not exists(select 1 from public.creator_publishing_scheduler_idempotency where idempotency_key='invalid-revision-key-0001'), 'invalid expected revision key stores no idempotency row');
select public.task15_assert(not exists(select 1 from public.creator_publishing_audit_events where action='creator_publishing_schedule_rescheduled' and idempotency_key='invalid-revision-key-0001'), 'invalid expected revision key writes no reschedule audit');
select public.task15_assert(not exists(select 1 from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000001' and schedule_revision=2), 'invalid expected revision key creates no revision two events');

select now() + interval '5 hours' as reschedule_intended_publish_at \gset
select public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',:'reschedule_intended_publish_at'::timestamptz,'UTC','reschedule-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000001'::uuid],jsonb_build_object('80000000-0000-4000-8000-000000000001',1),'reschedule') as reschedule_result \gset
select public.task15_assert((:'reschedule_result')::jsonb->>'idempotent' = 'false', 'first reschedule is not idempotent replay');
select public.task15_assert(schedule_revision=2, 'reschedule increments revision') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert(count(*)=2, 'prior events superseded') from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000001' and status='superseded';
select public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',:'reschedule_intended_publish_at'::timestamptz,'UTC','reschedule-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000001'::uuid],jsonb_build_object('80000000-0000-4000-8000-000000000001',1),'reschedule') as reschedule_replay_result \gset
select public.task15_assert((:'reschedule_replay_result')::jsonb->>'idempotent' = 'true', 'reschedule replay reports idempotent true');
select public.task15_assert((:'reschedule_replay_result')::jsonb - 'idempotent' = (:'reschedule_result')::jsonb - 'idempotent', 'reschedule replay matches original except idempotent flag');
select public.task15_assert(schedule_revision=2, 'reschedule replay leaves job revision two') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert((select count(*) from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000001' and schedule_revision=2)=2, 'reschedule replay creates no duplicate revision two events');
select public.task15_assert((select count(*) from public.creator_publishing_audit_events where action='creator_publishing_schedule_rescheduled' and idempotency_key='reschedule-key-0001')=1, 'single reschedule audit for replay');
select public.task15_assert((select count(*) from public.creator_publishing_scheduler_idempotency where action_type='reschedule' and idempotency_key='reschedule-key-0001')=1, 'single reschedule idempotency row');
select public.task15_assert((select result->>'idempotent' from public.creator_publishing_scheduler_idempotency where action_type='reschedule' and idempotency_key='reschedule-key-0001')='false', 'stored reschedule result remains non-idempotent');

select id as stale_event_id from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000001' and schedule_revision=1 and event_type='publish_due' \gset
update public.creator_publishing_scheduler_events set status='processing', lock_token='90000000-0000-4000-8000-000000000001', locked_at=clock_timestamp(), superseded_at=null where id=:'stale_event_id'::uuid;
select public.creator_publishing_process_scheduler_event(:'stale_event_id'::uuid, '90000000-0000-4000-8000-000000000001', 'creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12') as stale_revision_process_result \gset
select public.task15_assert((:'stale_revision_process_result')::jsonb->>'status' = 'superseded', 'stale revision returns superseded');
select public.task15_assert((:'stale_revision_process_result')::jsonb->>'code' = 'SCHEDULER_STALE_REVISION', 'stale revision returns code');
select public.task15_assert(((:'stale_revision_process_result')::jsonb->>'schedule_revision')::int = 2, 'stale revision returns current job revision');
select public.task15_assert(schedule_revision=2 and job_state='scheduled_internally', 'stale revision preserves current job state and revision') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert(status='superseded', 'stale revision event is superseded') from public.creator_publishing_scheduler_events where id=:'stale_event_id'::uuid;
select public.task15_assert(not exists(select 1 from public.creator_publishing_audit_events where action='creator_publishing_scheduler_gate_failed' and entity_id=:'stale_event_id'::uuid), 'stale revision creates no gate-failed audit');
select public.task15_assert((select after_state->>'safe_error_code' from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_superseded' and entity_id=:'stale_event_id'::uuid order by id desc limit 1)='SCHEDULER_STALE_REVISION', 'stale revision audit code');
select public.task15_assert((select (after_state->>'stale_schedule_revision')::int from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_superseded' and entity_id=:'stale_event_id'::uuid order by id desc limit 1)=1, 'stale revision audit stale revision');
select public.task15_assert((select (after_state->>'current_schedule_revision')::int from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_superseded' and entity_id=:'stale_event_id'::uuid order by id desc limit 1)=2, 'stale revision audit current revision');
select public.task15_assert((select after_state->>'job_state' from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_superseded' and entity_id=:'stale_event_id'::uuid order by id desc limit 1)='scheduled_internally', 'stale revision audit preserves job state');

-- Claim explicit grouping: a later pending event cannot bypass earlier-event exclusion.
update public.creator_publishing_scheduler_events set due_at=now()-interval '2 minutes' where platform_job_id='80000000-0000-4000-8000-000000000001' and schedule_revision=2 and event_type='operator_due';
update public.creator_publishing_scheduler_events set due_at=now()-interval '1 minutes' where platform_job_id='80000000-0000-4000-8000-000000000001' and schedule_revision=2 and event_type='publish_due';
select * from public.creator_publishing_claim_due_scheduler_events(25,15) \gset
select public.task15_assert(:'event_id' = (select id::text from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000001' and schedule_revision=2 and event_type='operator_due'), 'earlier operator event claimed first');
select public.task15_assert((select status from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000001' and schedule_revision=2 and event_type='publish_due')='pending', 'pending later event did not bypass earlier exclusion');
select public.task15_assert(not exists(select 1 from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_claimed' and (before_state::text like '%lock_token%' or after_state::text like '%lock_token%')), 'claim audit omits lock token');

-- Expired processing recovery truthful audit.
update public.creator_publishing_scheduler_events set locked_at=clock_timestamp()-interval '61 minutes' where id=:'event_id'::uuid;
select processing_attempts as old_attempts from public.creator_publishing_scheduler_events where id=:'event_id'::uuid \gset
select * from public.creator_publishing_claim_due_scheduler_events(1,15) \gset
select public.task15_assert((select before_state->>'status' from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_claimed' and entity_id=:'event_id'::uuid order by id desc limit 1)='processing', 'expired recovery audit prior status processing');
select public.task15_assert((select (before_state->>'processing_attempts')::int from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_claimed' and entity_id=:'event_id'::uuid order by id desc limit 1)=(:'old_attempts')::int, 'expired recovery audit prior attempts truthful');
select public.task15_assert((select (after_state->>'processing_attempts')::int from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_claimed' and entity_id=:'event_id'::uuid order by id desc limit 1)=(:'old_attempts')::int+1, 'expired recovery audit new attempts incremented');

select public.creator_publishing_process_scheduler_event(:'event_id'::uuid, :'lock_token'::uuid, 'creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12') as process_result \gset
select public.task15_assert((:'process_result')::jsonb->>'status' in ('processed','superseded'), 'processor returns safe status');
select id as obsolete_operator_event_id from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000001' and schedule_revision=2 and event_type='operator_due' \gset
select count(*) as obsolete_operator_prior_processed_audits from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_processed' and entity_id=:'obsolete_operator_event_id'::uuid \gset
update public.creator_publishing_platform_jobs set job_state='due_now', updated_at=now() where id='80000000-0000-4000-8000-000000000001';
update public.creator_publishing_scheduler_events set status='processing', lock_token='90000000-0000-4000-8000-000000000002', locked_at=clock_timestamp(), processed_at=null, superseded_at=null, safe_error_code=null, updated_at=now() where id=:'obsolete_operator_event_id'::uuid;
select public.creator_publishing_process_scheduler_event(:'obsolete_operator_event_id'::uuid, '90000000-0000-4000-8000-000000000002', 'creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12') as obsolete_operator_process_result \gset
select public.task15_assert((:'obsolete_operator_process_result')::jsonb->>'status' = 'superseded', 'obsolete operator returns superseded');
select public.task15_assert((:'obsolete_operator_process_result')::jsonb->>'code' = 'OBSOLETE_OPERATOR_DUE_SUPERSEDED', 'obsolete operator returns safe code');
select public.task15_assert(status='superseded' and superseded_at is not null and lock_token is null and locked_at is null, 'obsolete operator event superseded and lock cleared') from public.creator_publishing_scheduler_events where id=:'obsolete_operator_event_id'::uuid;
select public.task15_assert(job_state='due_now', 'obsolete operator leaves assisted job due_now') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert(status='pending', 'obsolete operator leaves sibling publish_due pending') from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000001' and schedule_revision=2 and event_type='publish_due';
select public.task15_assert((select before_state->>'status' from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_superseded' and entity_id=:'obsolete_operator_event_id'::uuid order by id desc limit 1)='processing', 'obsolete operator audit before status');
select public.task15_assert((select before_state->>'event_type' from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_superseded' and entity_id=:'obsolete_operator_event_id'::uuid order by id desc limit 1)='operator_due', 'obsolete operator audit before event type');
select public.task15_assert((select (before_state->>'schedule_revision')::int from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_superseded' and entity_id=:'obsolete_operator_event_id'::uuid order by id desc limit 1)=2, 'obsolete operator audit before revision');
select public.task15_assert((select after_state->>'status' from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_superseded' and entity_id=:'obsolete_operator_event_id'::uuid order by id desc limit 1)='superseded', 'obsolete operator audit after status');
select public.task15_assert((select after_state->>'safe_error_code' from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_superseded' and entity_id=:'obsolete_operator_event_id'::uuid order by id desc limit 1)='OBSOLETE_OPERATOR_DUE_SUPERSEDED', 'obsolete operator audit safe code');
select public.task15_assert((select after_state->>'job_state' from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_superseded' and entity_id=:'obsolete_operator_event_id'::uuid order by id desc limit 1)='due_now', 'obsolete operator audit job state');
select public.task15_assert(not exists(select 1 from public.creator_publishing_audit_events where action='creator_publishing_scheduler_gate_failed' and entity_id=:'obsolete_operator_event_id'::uuid), 'obsolete operator creates no gate-failed audit');
select public.task15_assert((select count(*) from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_processed' and entity_id=:'obsolete_operator_event_id'::uuid)=(:'obsolete_operator_prior_processed_audits')::int, 'obsolete operator adds no processed audit');
select public.task15_assert((select count(*) from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_superseded' and entity_id=:'obsolete_operator_event_id'::uuid and after_state->>'safe_error_code'='OBSOLETE_OPERATOR_DUE_SUPERSEDED')=1, 'obsolete operator writes one supersede audit');

update public.creator_publishing_platform_jobs set job_state='direct_publish_failed', updated_at=now() where id='80000000-0000-4000-8000-000000000001';
update public.creator_publishing_scheduler_events set due_at=now()-interval '1 minute' where platform_job_id='80000000-0000-4000-8000-000000000001' and schedule_revision=2 and event_type='publish_due';
select * from public.creator_publishing_claim_due_scheduler_events(1,15) \gset
select public.creator_publishing_process_scheduler_event(:'event_id'::uuid, :'lock_token'::uuid, 'creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12') as terminal_process_result \gset
select public.task15_assert((:'terminal_process_result')::jsonb->>'status' = 'superseded', 'terminal job process returns superseded');
select public.task15_assert((:'terminal_process_result')::jsonb->>'code' = 'JOB_TERMINAL', 'terminal job process returns JOB_TERMINAL');
select public.task15_assert(job_state='direct_publish_failed', 'terminal job state remains direct_publish_failed') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert(status='superseded', 'terminal publish event is superseded') from public.creator_publishing_scheduler_events where id=:'event_id'::uuid;
select public.task15_assert(not exists(select 1 from public.creator_publishing_audit_events where action='creator_publishing_scheduler_gate_failed' and entity_id=:'event_id'::uuid), 'terminal supersede creates no gate-failed audit');
select public.task15_assert((select after_state->>'job_state' from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_superseded' and entity_id=:'event_id'::uuid order by id desc limit 1)='direct_publish_failed', 'terminal supersede audit preserves direct_publish_failed state');
select count(*) as terminal_gate_event_count_before from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000001' \gset
select public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',now()+interval '6 hours','UTC','terminal-schedule-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000001'::uuid],'{}','schedule') as terminal_schedule_result \gset
select public.task15_assert(((:'terminal_schedule_result')::jsonb->>'success_count')::int=0 and ((:'terminal_schedule_result')::jsonb->>'failure_count')::int=1 and (:'terminal_schedule_result')::jsonb->>'idempotent'='false', 'terminal schedule returns one failure');
select public.task15_assert((:'terminal_schedule_result')::jsonb->'jobs'->0->>'job_id'='80000000-0000-4000-8000-000000000001' and (:'terminal_schedule_result')::jsonb->'jobs'->0->>'status'='failed' and (:'terminal_schedule_result')::jsonb->'jobs'->0->>'safe_error_code'='JOB_TERMINAL' and (:'terminal_schedule_result')::jsonb->'jobs'->0->>'mutated'='false', 'terminal schedule returns JOB_TERMINAL');
select public.task15_assert((:'terminal_schedule_result')::jsonb::text not like '%SCHEDULER_JOB_NOT_DRAFT%', 'terminal schedule does not report not-draft');
select public.task15_assert(job_state='direct_publish_failed' and schedule_revision=2, 'terminal schedule leaves job terminal revision two') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert((select count(*) from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000001')=(:'terminal_gate_event_count_before')::int, 'terminal schedule does not create events');
select public.task15_assert(not exists(select 1 from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000001' and schedule_revision=3), 'terminal schedule creates no revision three event');
select public.task15_assert((select count(*) from public.creator_publishing_scheduler_idempotency where action_type='schedule' and idempotency_key='terminal-schedule-key-0001')=1, 'terminal schedule stores one idempotency row');
select public.task15_assert((select result->>'idempotent' from public.creator_publishing_scheduler_idempotency where action_type='schedule' and idempotency_key='terminal-schedule-key-0001')='false' and (select result->'jobs'->0->>'safe_error_code' from public.creator_publishing_scheduler_idempotency where action_type='schedule' and idempotency_key='terminal-schedule-key-0001')='JOB_TERMINAL', 'terminal schedule stored result records JOB_TERMINAL');
select public.task15_assert((select count(*) from public.creator_publishing_audit_events where action='creator_publishing_schedule_created' and idempotency_key='terminal-schedule-key-0001')=1, 'terminal schedule writes one audit');
select public.task15_assert((select (after_state->>'success_count')::int from public.creator_publishing_audit_events where action='creator_publishing_schedule_created' and idempotency_key='terminal-schedule-key-0001' order by id desc limit 1)=0 and (select (after_state->>'failure_count')::int from public.creator_publishing_audit_events where action='creator_publishing_schedule_created' and idempotency_key='terminal-schedule-key-0001' order by id desc limit 1)=1 and (select after_state->'jobs'->0->>'safe_error_code' from public.creator_publishing_audit_events where action='creator_publishing_schedule_created' and idempotency_key='terminal-schedule-key-0001' order by id desc limit 1)='JOB_TERMINAL', 'terminal schedule audit records JOB_TERMINAL');
select public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',now()+interval '7 hours','UTC','terminal-reschedule-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000001'::uuid],jsonb_build_object('80000000-0000-4000-8000-000000000001',2),'reschedule') as terminal_reschedule_result \gset
select public.task15_assert(((:'terminal_reschedule_result')::jsonb->>'success_count')::int=0 and ((:'terminal_reschedule_result')::jsonb->>'failure_count')::int=1 and (:'terminal_reschedule_result')::jsonb->>'idempotent'='false', 'terminal reschedule returns one failure');
select public.task15_assert((:'terminal_reschedule_result')::jsonb->'jobs'->0->>'job_id'='80000000-0000-4000-8000-000000000001' and (:'terminal_reschedule_result')::jsonb->'jobs'->0->>'status'='failed' and (:'terminal_reschedule_result')::jsonb->'jobs'->0->>'safe_error_code'='JOB_TERMINAL' and (:'terminal_reschedule_result')::jsonb->'jobs'->0->>'mutated'='false', 'terminal reschedule returns JOB_TERMINAL');
select public.task15_assert((:'terminal_reschedule_result')::jsonb::text not like '%SCHEDULER_RESCHEDULE_STATE_BLOCKED%', 'terminal reschedule does not report state blocked');
select public.task15_assert(job_state='direct_publish_failed' and schedule_revision=2, 'terminal reschedule leaves job terminal revision two') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert((select count(*) from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000001')=(:'terminal_gate_event_count_before')::int, 'terminal reschedule does not create events');
select public.task15_assert(not exists(select 1 from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000001' and schedule_revision=3), 'terminal reschedule creates no revision three event');
select public.task15_assert((select count(*) from public.creator_publishing_scheduler_idempotency where action_type='reschedule' and idempotency_key='terminal-reschedule-key-0001')=1, 'terminal reschedule stores one idempotency row');
select public.task15_assert((select result->>'idempotent' from public.creator_publishing_scheduler_idempotency where action_type='reschedule' and idempotency_key='terminal-reschedule-key-0001')='false' and (select result->'jobs'->0->>'safe_error_code' from public.creator_publishing_scheduler_idempotency where action_type='reschedule' and idempotency_key='terminal-reschedule-key-0001')='JOB_TERMINAL', 'terminal reschedule stored result records JOB_TERMINAL');
select public.task15_assert((select count(*) from public.creator_publishing_audit_events where action='creator_publishing_schedule_rescheduled' and idempotency_key='terminal-reschedule-key-0001')=1, 'terminal reschedule writes one audit');
select public.task15_assert((select (after_state->>'success_count')::int from public.creator_publishing_audit_events where action='creator_publishing_schedule_rescheduled' and idempotency_key='terminal-reschedule-key-0001' order by id desc limit 1)=0 and (select (after_state->>'failure_count')::int from public.creator_publishing_audit_events where action='creator_publishing_schedule_rescheduled' and idempotency_key='terminal-reschedule-key-0001' order by id desc limit 1)=1 and (select after_state->'jobs'->0->>'safe_error_code' from public.creator_publishing_audit_events where action='creator_publishing_schedule_rescheduled' and idempotency_key='terminal-reschedule-key-0001' order by id desc limit 1)='JOB_TERMINAL', 'terminal reschedule audit records JOB_TERMINAL');

select public.creator_publishing_cancel_job_schedule('00000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','Task 15 terminal cancellation fixture','cancel-job-key-0001') as cancel_job_result \gset
select public.task15_assert((:'cancel_job_result')::jsonb->>'ok' = 'true', 'terminal job cancellation succeeds');
select public.task15_assert((:'cancel_job_result')::jsonb->>'idempotent' = 'false', 'first job cancellation is not idempotent replay');
select public.creator_publishing_cancel_job_schedule('00000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','Task 15 terminal cancellation fixture','cancel-job-key-0001') as cancel_job_replay_result \gset
select public.task15_assert((:'cancel_job_replay_result')::jsonb->>'idempotent' = 'true', 'job cancellation replay reports idempotent true');
select public.task15_assert((:'cancel_job_replay_result')::jsonb - 'idempotent' = (:'cancel_job_result')::jsonb - 'idempotent', 'job cancellation replay matches original except idempotent flag');
select public.task15_assert(job_state='direct_publish_failed', 'terminal job cancellation preserves direct_publish_failed') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert(job_state <> 'archived', 'terminal job cancellation does not archive') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert(cancelled_at is null and cancelled_by is null and cancellation_reason is null, 'terminal job cancellation metadata remains unchanged') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert((select before_state->>'job_state' from public.creator_publishing_audit_events where action='creator_publishing_job_schedule_cancelled' and entity_id='80000000-0000-4000-8000-000000000001' order by id desc limit 1)='direct_publish_failed', 'terminal job cancel audit before state truthful');
select public.task15_assert((select after_state->>'job_state' from public.creator_publishing_audit_events where action='creator_publishing_job_schedule_cancelled' and entity_id='80000000-0000-4000-8000-000000000001' order by id desc limit 1)='direct_publish_failed', 'terminal job cancel audit after state truthful');
select public.task15_assert((select after_state->>'reason' from public.creator_publishing_audit_events where action='creator_publishing_job_schedule_cancelled' and entity_id='80000000-0000-4000-8000-000000000001' order by id desc limit 1)='Task 15 terminal cancellation fixture', 'terminal job cancel audit reason truthful');
select public.task15_assert((select count(*) from public.creator_publishing_audit_events where action='creator_publishing_job_schedule_cancelled' and idempotency_key='cancel-job-key-0001')=1, 'single job cancellation audit for replay');
select public.task15_assert((select count(*) from public.creator_publishing_scheduler_idempotency where action_type='cancel_job' and idempotency_key='cancel-job-key-0001')=1, 'single job cancellation idempotency row');
select public.task15_assert((select result->>'idempotent' from public.creator_publishing_scheduler_idempotency where action_type='cancel_job' and idempotency_key='cancel-job-key-0001')='false', 'stored job cancellation result remains non-idempotent');

select public.creator_publishing_cancel_plan_schedule('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','Task 15 plan cancellation fixture','cancel-plan-key-0001') as cancel_plan_result \gset
select public.task15_assert((:'cancel_plan_result')::jsonb->>'idempotent' = 'false', 'first plan cancellation is not idempotent replay');
select public.creator_publishing_cancel_plan_schedule('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','Task 15 plan cancellation fixture','cancel-plan-key-0001') as cancel_plan_replay_result \gset
select public.task15_assert((:'cancel_plan_replay_result')::jsonb->>'idempotent' = 'true', 'plan cancellation replay reports idempotent true');
select public.task15_assert((:'cancel_plan_replay_result')::jsonb - 'idempotent' = (:'cancel_plan_result')::jsonb - 'idempotent', 'plan cancellation replay matches original except idempotent flag');
select public.task15_assert((select status from public.creator_publishing_plans where id='70000000-0000-4000-8000-000000000001')='cancelled', 'plan cancellation marks plan cancelled');
select public.task15_assert(job_state='direct_publish_failed', 'plan cancellation preserves terminal failed job') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert(job_state='archived', 'plan cancellation archives nonterminal job') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000002';
select public.task15_assert(cancellation_reason='Task 15 plan cancellation fixture', 'plan cancellation reason applied to archived nonterminal job') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000002';
select public.task15_assert(cancelled_at is null and cancelled_by is null and cancellation_reason is null, 'plan cancellation does not replace terminal job metadata') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert((select after_state->>'status' from public.creator_publishing_audit_events where action='creator_publishing_schedule_cancelled' and entity_id='70000000-0000-4000-8000-000000000001' order by id desc limit 1)='cancelled', 'plan cancel audit status');
select public.task15_assert((select after_state->>'reason' from public.creator_publishing_audit_events where action='creator_publishing_schedule_cancelled' and entity_id='70000000-0000-4000-8000-000000000001' order by id desc limit 1)='Task 15 plan cancellation fixture', 'plan cancel audit reason');
select public.task15_assert((select count(*) from public.creator_publishing_audit_events where action='creator_publishing_schedule_cancelled' and idempotency_key='cancel-plan-key-0001')=1, 'single plan cancellation audit for replay');
select public.task15_assert((select count(*) from public.creator_publishing_scheduler_idempotency where action_type='cancel_plan' and idempotency_key='cancel-plan-key-0001')=1, 'single plan cancellation idempotency row');
select public.task15_assert((select result->>'idempotent' from public.creator_publishing_scheduler_idempotency where action_type='cancel_plan' and idempotency_key='cancel-plan-key-0001')='false', 'stored plan cancellation result remains non-idempotent');

insert into public.creator_publishing_plans(id,creator_id,status,idempotency_key,request_fingerprint,registry_version,created_at,updated_at)
values ('70000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','draft','invalid-transition-plan-key-0001','4444444444444444444444444444444444444444444444444444444444444445','task14.20260711.001',now(),now());
insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,created_at,updated_at)
values ('80000000-0000-4000-8000-000000000005','70000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','onlyfans','assisted','draft',(select updated_at from public.creator_publishing_content_packages where id='30000000-0000-4000-8000-000000000001'),public.creator_publishing_autopost_source_fingerprint('30000000-0000-4000-8000-000000000001'),'task14.20260711.001','5555555555555555555555555555555555555555555555555555555555555555',now(),now());
select public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000004',now()+interval '3 hours','UTC','invalid-transition-schedule-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000005'::uuid],'{}','schedule');
select public.task15_assert(schedule_revision=1 and job_state='scheduled_internally', 'invalid transition fixture schedules assisted job') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000005';
select public.task15_assert((select count(*) from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000005' and schedule_revision=1 and event_type='operator_due')=1, 'invalid transition fixture creates operator_due event');
select public.task15_assert((select count(*) from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000005' and schedule_revision=1 and event_type='publish_due')=1, 'invalid transition fixture creates publish_due event');
update public.creator_publishing_platform_jobs set job_state='ready_to_publish', updated_at=now() where id='80000000-0000-4000-8000-000000000005';
update public.creator_publishing_scheduler_events set due_at=now()-interval '1 minute', updated_at=now() where platform_job_id='80000000-0000-4000-8000-000000000005' and schedule_revision=1 and event_type='operator_due';
select event_id as invalid_transition_event_id, lock_token as invalid_transition_lock_token from public.creator_publishing_claim_due_scheduler_events(1,15) \gset
select public.task15_assert(
  :'invalid_transition_event_id'::uuid = (
    select id
    from public.creator_publishing_scheduler_events
    where platform_job_id = '80000000-0000-4000-8000-000000000005'
      and schedule_revision = 1
      and event_type = 'operator_due'
  ),
  'invalid transition test claimed assisted operator_due event'
);
select public.creator_publishing_process_scheduler_event(:'invalid_transition_event_id'::uuid, :'invalid_transition_lock_token'::uuid, 'creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12') as invalid_transition_process_result \gset
select public.task15_assert((:'invalid_transition_process_result')::jsonb->>'status' = 'blocked', 'invalid transition process blocks event');
select public.task15_assert((:'invalid_transition_process_result')::jsonb->>'safe_error_code' = 'SCHEDULER_STATE_TRANSITION_INVALID', 'invalid transition process returns safe code');
select public.task15_assert(status='blocked' and safe_error_code='SCHEDULER_STATE_TRANSITION_INVALID' and lock_token is null and locked_at is null, 'invalid transition event blocked and lock cleared') from public.creator_publishing_scheduler_events where id=:'invalid_transition_event_id'::uuid;
select public.task15_assert(job_state='needs_fix', 'invalid transition assisted job becomes needs_fix') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000005';
select public.task15_assert(job_state <> 'awaiting_operator', 'invalid transition assisted job does not advance to awaiting_operator') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000005';
select public.task15_assert(status='superseded', 'invalid transition sibling publish_due superseded') from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000005' and schedule_revision=1 and event_type='publish_due';
select public.task15_assert((select after_state->>'safe_error_code' from public.creator_publishing_audit_events where action='creator_publishing_scheduler_gate_failed' and entity_id=:'invalid_transition_event_id'::uuid order by id desc limit 1)='SCHEDULER_STATE_TRANSITION_INVALID', 'invalid transition gate audit records safe code');
select public.task15_assert(not exists(select 1 from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_processed' and entity_id=:'invalid_transition_event_id'::uuid), 'invalid transition does not write processed audit');
select public.task15_assert((:'invalid_transition_process_result')::jsonb->>'status' <> 'processed', 'invalid transition result is not processed');

-- Test-only direct and planner by modifying disposable Fansly capability only.
update public.creator_publishing_platform_capabilities set publishing_mode='direct', availability_status='available', connector_can_publish_immediately=true, human_publishing_required=false where platform='fansly';
insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,created_at,updated_at)
values ('80000000-0000-4000-8000-000000000003','70000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','fansly','direct','draft',(select updated_at from public.creator_publishing_content_packages where id='30000000-0000-4000-8000-000000000003'),public.creator_publishing_autopost_source_fingerprint('30000000-0000-4000-8000-000000000003'),'task14.20260711.001','3333333333333333333333333333333333333333333333333333333333333333',now(),now());
select public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002',now()+interval '3 hours','UTC','direct-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000003'::uuid],'{}','schedule');
select public.task15_assert(job_state='ready_to_publish', 'direct schedule stops at ready_to_publish') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000003';
update public.creator_platform_accounts set verification_status='revoked', updated_at=now() where id='20000000-0000-4000-8000-000000000003';
update public.creator_publishing_scheduler_events set due_at=now()-interval '1 minute', updated_at=now() where platform_job_id='80000000-0000-4000-8000-000000000003' and schedule_revision=1 and event_type='publish_due';
select event_id as revoked_account_event_id, lock_token as revoked_account_lock_token from public.creator_publishing_claim_due_scheduler_events(1,15) \gset
select public.creator_publishing_process_scheduler_event(:'revoked_account_event_id'::uuid, :'revoked_account_lock_token'::uuid, 'creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12') as revoked_account_process_result \gset
select public.task15_assert((:'revoked_account_process_result')::jsonb->>'status' = 'blocked', 'revoked account process blocks event');
select public.task15_assert((:'revoked_account_process_result')::jsonb->>'safe_error_code' = 'DESTINATION_ACCOUNT_REVOKED', 'revoked account process reports revoked code');
select public.task15_assert(job_state='blocked', 'revoked account direct job becomes blocked') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000003';
select public.task15_assert(job_state <> 'direct_publish_queued', 'revoked account direct job does not queue direct publish') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000003';
select public.task15_assert(status='blocked' and safe_error_code='DESTINATION_ACCOUNT_REVOKED', 'revoked account event blocked with safe code') from public.creator_publishing_scheduler_events where id=:'revoked_account_event_id'::uuid;
select public.task15_assert((select after_state->>'safe_error_code' from public.creator_publishing_audit_events where action='creator_publishing_scheduler_gate_failed' and entity_id=:'revoked_account_event_id'::uuid order by id desc limit 1)='DESTINATION_ACCOUNT_REVOKED', 'revoked account gate audit records safe code');

update public.creator_publishing_platform_capabilities set publishing_mode='planner', connector_can_publish_immediately=false where platform='fansly';
insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,created_at,updated_at)
values ('80000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000004','fansly','planner','draft',(select updated_at from public.creator_publishing_content_packages where id='30000000-0000-4000-8000-000000000004'),public.creator_publishing_autopost_source_fingerprint('30000000-0000-4000-8000-000000000004'),'task14.20260711.001','4444444444444444444444444444444444444444444444444444444444444444',now(),now());
update public.creator_platform_accounts set verification_status='revoked', updated_at=now() where id='20000000-0000-4000-8000-000000000004';
select public.task15_assert(verification_status='revoked', 'planner account fixture is revoked before schedule') from public.creator_platform_accounts where id='20000000-0000-4000-8000-000000000004';
select public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000003',now()+interval '3 hours','UTC','planner-revoked-account-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000004'::uuid],'{}','schedule') as planner_revoked_account_schedule_result \gset
select public.task15_assert(((:'planner_revoked_account_schedule_result')::jsonb->>'success_count')::int=0 and ((:'planner_revoked_account_schedule_result')::jsonb->>'failure_count')::int=1 and (:'planner_revoked_account_schedule_result')::jsonb->>'idempotent'='false', 'revoked planner account schedule returns one failure');
select public.task15_assert((:'planner_revoked_account_schedule_result')::jsonb->'jobs'->0->>'job_id'='80000000-0000-4000-8000-000000000004' and (:'planner_revoked_account_schedule_result')::jsonb->'jobs'->0->>'status'='failed' and (:'planner_revoked_account_schedule_result')::jsonb->'jobs'->0->>'safe_error_code'='DESTINATION_ACCOUNT_REVOKED' and (:'planner_revoked_account_schedule_result')::jsonb->'jobs'->0->>'mutated'='false', 'revoked planner account schedule returns revoked account code');
select public.task15_assert(job_state='draft' and schedule_revision is null and intended_publish_at is null and schedule_timezone is null and scheduled_at is null, 'revoked planner account leaves job unscheduled') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000004';
select public.task15_assert(not exists(select 1 from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000004'), 'revoked planner account creates no scheduler events');
select public.task15_assert((select count(*) from public.creator_publishing_scheduler_idempotency where action_type='schedule' and idempotency_key='planner-revoked-account-key-0001')=1, 'revoked planner account stores one idempotency row');
select public.task15_assert((select result->>'idempotent' from public.creator_publishing_scheduler_idempotency where action_type='schedule' and idempotency_key='planner-revoked-account-key-0001')='false' and (select result->'jobs'->0->>'safe_error_code' from public.creator_publishing_scheduler_idempotency where action_type='schedule' and idempotency_key='planner-revoked-account-key-0001')='DESTINATION_ACCOUNT_REVOKED', 'revoked planner account stored result stays non-idempotent with revoked code');
select public.task15_assert((select count(*) from public.creator_publishing_audit_events where action='creator_publishing_schedule_created' and idempotency_key='planner-revoked-account-key-0001')=1, 'revoked planner account writes one schedule audit');
select public.task15_assert((select (after_state->>'success_count')::int from public.creator_publishing_audit_events where action='creator_publishing_schedule_created' and idempotency_key='planner-revoked-account-key-0001' order by id desc limit 1)=0 and (select (after_state->>'failure_count')::int from public.creator_publishing_audit_events where action='creator_publishing_schedule_created' and idempotency_key='planner-revoked-account-key-0001' order by id desc limit 1)=1 and (select after_state->'jobs'->0->>'safe_error_code' from public.creator_publishing_audit_events where action='creator_publishing_schedule_created' and idempotency_key='planner-revoked-account-key-0001' order by id desc limit 1)='DESTINATION_ACCOUNT_REVOKED', 'revoked planner account audit records counts and code');
update public.creator_platform_accounts set verification_status='verified', updated_at=now() where id='20000000-0000-4000-8000-000000000004';
select public.task15_assert(verification_status='verified', 'planner account fixture restored to verified') from public.creator_platform_accounts where id='20000000-0000-4000-8000-000000000004';
select public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000003',now()+interval '3 hours','UTC','planner-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000004'::uuid],'{}','schedule');
select public.task15_assert(job_state='package_ready' and schedule_revision=1, 'planner schedule stops at package_ready') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000004';
update public.creator_publishing_creator_verifications
set status = 'revoked',
    reason = 'Task 15 creator verification revoked fixture',
    updated_at = now()
where creator_id = '00000000-0000-4000-8000-000000000001';
select public.task15_assert(status='revoked', 'creator verification fixture is revoked') from public.creator_publishing_creator_verifications where creator_id='00000000-0000-4000-8000-000000000001';
update public.creator_publishing_scheduler_events set due_at=now()-interval '1 minute', updated_at=now() where platform_job_id='80000000-0000-4000-8000-000000000004' and schedule_revision=1 and event_type='publish_due';
select event_id as revoked_creator_event_id, lock_token as revoked_creator_lock_token from public.creator_publishing_claim_due_scheduler_events(1,15) \gset
select public.task15_assert(
  :'revoked_creator_event_id'::uuid = (
    select id
    from public.creator_publishing_scheduler_events
    where platform_job_id = '80000000-0000-4000-8000-000000000004'
      and schedule_revision = 1
      and event_type = 'publish_due'
  ),
  'revoked creator test claimed planner publish_due event'
);
select public.creator_publishing_process_scheduler_event(:'revoked_creator_event_id'::uuid, :'revoked_creator_lock_token'::uuid, 'creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12') as revoked_creator_process_result \gset
select public.task15_assert((:'revoked_creator_process_result')::jsonb->>'status' = 'blocked', 'revoked creator process blocks event');
select public.task15_assert((:'revoked_creator_process_result')::jsonb->>'safe_error_code' = 'CREATOR_VERIFICATION_MISSING', 'revoked creator process reports creator verification missing');
select public.task15_assert(status='blocked' and safe_error_code='CREATOR_VERIFICATION_MISSING', 'revoked creator event blocked with safe code') from public.creator_publishing_scheduler_events where id=:'revoked_creator_event_id'::uuid;
select public.task15_assert(job_state='needs_fix', 'revoked creator planner job becomes needs_fix') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000004';
select public.task15_assert(job_state <> 'ready_for_export', 'revoked creator planner job does not advance to ready_for_export') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000004';
select public.task15_assert((select after_state->>'safe_error_code' from public.creator_publishing_audit_events where action='creator_publishing_scheduler_gate_failed' and entity_id=:'revoked_creator_event_id'::uuid order by id desc limit 1)='CREATOR_VERIFICATION_MISSING', 'revoked creator gate audit records safe code');

update public.creator_publishing_creator_verifications set status='verified', updated_at=now() where creator_id='00000000-0000-4000-8000-000000000001';
select public.task15_assert(status='verified', 'creator verification restored for due trusted gate fixtures') from public.creator_publishing_creator_verifications where creator_id='00000000-0000-4000-8000-000000000001';

insert into public.creator_publishing_content_packages(id,creator_id,platform_account_id,target_platform,title,caption_body,forced_disclosure_text,ai_flag,ai_detail,second_person_present,compliance_status,compliance_policy_version,creator_approval_status,creator_approved_at,creator_approved_by,created_at,updated_at)
values
('30000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','onlyfans','due queue pkg','caption','#AI','ai_generated','{}',false,'pending','unassigned','pending',null,null,now(),now()),
('30000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004','fansly','due co pkg','caption',null,'ai_generated','{}',true,'pending','unassigned','pending',null,null,now(),now()),
('30000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004','fansly','due compliance pkg','caption',null,'ai_generated','{}',false,'pending','unassigned','pending',null,null,now(),now()),
('30000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004','fansly','due conflict pkg','caption',null,'ai_generated','{}',false,'pending','unassigned','pending',null,null,now(),now());
insert into public.generations(id,user_id,status,r2_bucket,r2_key,metadata) values
('40000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','completed','bucket','key5','{}'),
('40000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','completed','bucket','key6','{}'),
('40000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000001','completed','bucket','key7','{}'),
('40000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000001','completed','bucket','key8','{}');
insert into public.creator_publishing_media_assets(id,content_package_id,storage_key,mime_type,sha256,source,ai_generation_metadata,created_at) values
('50000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000005','media/key5','image/png','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','ai_pipeline','{"generation_id":"40000000-0000-4000-8000-000000000005"}',now()),
('50000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000006','media/key6','image/png','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff','ai_pipeline','{"generation_id":"40000000-0000-4000-8000-000000000006"}',now()),
('50000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000007','media/key7','image/png','1111111111111111111111111111111111111111111111111111111111111111','ai_pipeline','{"generation_id":"40000000-0000-4000-8000-000000000007"}',now()),
('50000000-0000-4000-8000-000000000008','30000000-0000-4000-8000-000000000008','media/key8','image/png','2222222222222222222222222222222222222222222222222222222222222222','ai_pipeline','{"generation_id":"40000000-0000-4000-8000-000000000008"}',now());
insert into public.creator_publishing_compliance_reviews(content_package_id,reviewer_id,outcome,review_source,rule_hits,compliance_policy_version,created_at,review_metadata)
values
('30000000-0000-4000-8000-000000000005',null,'pass','automated','[]'::jsonb,'policy-v1',now()-interval '10 minutes','{}'::jsonb),
('30000000-0000-4000-8000-000000000006',null,'pass','automated','[]'::jsonb,'policy-v1',now()-interval '10 minutes','{}'::jsonb),
('30000000-0000-4000-8000-000000000007',null,'pass','automated','[]'::jsonb,'policy-v1',now()-interval '10 minutes','{}'::jsonb),
('30000000-0000-4000-8000-000000000008',null,'pass','automated','[]'::jsonb,'policy-v1',now()-interval '10 minutes','{}'::jsonb);
update public.creator_publishing_content_packages
set compliance_status='passed',
    compliance_policy_version='policy-v1',
    creator_approval_status='approved',
    creator_approved_at=now(),
    creator_approved_by='00000000-0000-4000-8000-000000000001',
    updated_at=now()
where id in (
  '30000000-0000-4000-8000-000000000005',
  '30000000-0000-4000-8000-000000000006',
  '30000000-0000-4000-8000-000000000007',
  '30000000-0000-4000-8000-000000000008'
);
insert into public.creator_publishing_queue_tasks(id,content_package_id,creator_id,target_platform,platform_account_id,status,due_at,created_at,updated_at)
values ('60000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','onlyfans','20000000-0000-4000-8000-000000000001','ready_for_handoff',null,now(),now());
insert into public.creator_publishing_co_performer_records(id,content_package_id,person_name,release_document_reference,platform_release_confirmed,created_at)
values ('61000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000006','Co Performer','release-ref',true,now());
insert into public.creator_publishing_plans(id,creator_id,status,idempotency_key,request_fingerprint,registry_version,created_at,updated_at)
values
('70000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','draft','due-queue-plan-key-0001','5555555555555555555555555555555555555555555555555555555555555555','task14.20260711.001',now(),now()),
('70000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','draft','due-co-plan-key-0001','6666666666666666666666666666666666666666666666666666666666666666','task14.20260711.001',now(),now()),
('70000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000001','draft','due-compliance-plan-key-0001','7777777777777777777777777777777777777777777777777777777777777777','task14.20260711.001',now(),now()),
('70000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000001','draft','due-conflict-plan-key-0001','8888888888888888888888888888888888888888888888888888888888888888','task14.20260711.001',now(),now());
insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,created_at,updated_at)
values
('80000000-0000-4000-8000-000000000006','70000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000001','onlyfans','assisted','draft',(select updated_at from public.creator_publishing_content_packages where id='30000000-0000-4000-8000-000000000005'),public.creator_publishing_autopost_source_fingerprint('30000000-0000-4000-8000-000000000005'),'task14.20260711.001','6666666666666666666666666666666666666666666666666666666666666666',now(),now()),
('80000000-0000-4000-8000-000000000007','70000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000004','fansly','planner','draft',(select updated_at from public.creator_publishing_content_packages where id='30000000-0000-4000-8000-000000000006'),public.creator_publishing_autopost_source_fingerprint('30000000-0000-4000-8000-000000000006'),'task14.20260711.001','7777777777777777777777777777777777777777777777777777777777777777',now(),now()),
('80000000-0000-4000-8000-000000000008','70000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000004','fansly','planner','draft',(select updated_at from public.creator_publishing_content_packages where id='30000000-0000-4000-8000-000000000007'),public.creator_publishing_autopost_source_fingerprint('30000000-0000-4000-8000-000000000007'),'task14.20260711.001','8888888888888888888888888888888888888888888888888888888888888888',now(),now()),
('80000000-0000-4000-8000-000000000009','70000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000004','fansly','planner','draft',(select updated_at from public.creator_publishing_content_packages where id='30000000-0000-4000-8000-000000000008'),public.creator_publishing_autopost_source_fingerprint('30000000-0000-4000-8000-000000000008'),'task14.20260711.001','9999999999999999999999999999999999999999999999999999999999999999',now(),now());

select public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000005',now()+interval '3 hours','UTC','due-queue-schedule-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000006'::uuid],'{}','schedule');
select public.task15_assert(job_state='scheduled_internally' and schedule_revision=1, 'due queue fixture scheduled assisted job') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000006';
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='creator_publishing_queue_tasks' and column_name='claim_token') then
    update public.creator_publishing_queue_tasks
    set status='claimed',
        claimed_by='00000000-0000-4000-8000-000000000002',
        claimed_at=now(),
        claim_token='90000000-0000-4000-8000-000000000666',
        claim_expires_at=now()+interval '30 minutes',
        updated_at=now()
    where id='60000000-0000-4000-8000-000000000003';
  else
    update public.creator_publishing_queue_tasks
    set status='claimed', claimed_by='00000000-0000-4000-8000-000000000001', claimed_at=now(), updated_at=now()
    where id='60000000-0000-4000-8000-000000000003';
  end if;
end $$;
select public.task15_assert(source_package_fingerprint=public.creator_publishing_autopost_source_fingerprint(content_package_id), 'due queue mutation leaves source fingerprint current') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000006';
update public.creator_publishing_scheduler_events set status='processing', lock_token='90000000-0000-4000-8000-000000000006', locked_at=clock_timestamp(), updated_at=now() where platform_job_id='80000000-0000-4000-8000-000000000006' and schedule_revision=1 and event_type='operator_due';
select id as due_queue_event_id from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000006' and schedule_revision=1 and event_type='operator_due' \gset
select public.creator_publishing_process_scheduler_event(:'due_queue_event_id'::uuid,'90000000-0000-4000-8000-000000000006','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12') as due_queue_result \gset
select public.task15_assert((:'due_queue_result')::jsonb->>'status'='blocked' and (:'due_queue_result')::jsonb->>'safe_error_code'='ACTIVE_QUEUE_TASK_CONFLICT', 'due queue conflict blocks processing');
select public.task15_assert(job_state='blocked' and job_state <> 'awaiting_operator', 'due queue conflict blocks job') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000006';
select public.task15_assert(status='blocked' and safe_error_code='ACTIVE_QUEUE_TASK_CONFLICT', 'due queue event blocked with safe code') from public.creator_publishing_scheduler_events where id=:'due_queue_event_id'::uuid;
select public.task15_assert(status='superseded', 'due queue sibling publish_due superseded') from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000006' and event_type='publish_due';
select public.task15_assert((select status from public.creator_publishing_queue_tasks where id='60000000-0000-4000-8000-000000000003')='claimed', 'due queue task remains claimed');
select public.task15_assert((select count(*) from public.creator_publishing_audit_events where action='creator_publishing_scheduler_gate_failed' and entity_id=:'due_queue_event_id'::uuid and after_state->>'safe_error_code'='ACTIVE_QUEUE_TASK_CONFLICT')=1, 'due queue audit records conflict');
select public.task15_assert(not exists(select 1 from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_processed' and entity_id=:'due_queue_event_id'::uuid), 'due queue conflict writes no processed audit');

select public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000006',now()+interval '3 hours','UTC','due-co-performer-schedule-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000007'::uuid],'{}','schedule');
select public.task15_assert(job_state='package_ready' and schedule_revision=1, 'due co-performer fixture scheduled planner job') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000007';
update public.creator_publishing_co_performer_records set platform_release_confirmed=false where id='61000000-0000-4000-8000-000000000001';
select public.task15_assert(source_package_fingerprint=public.creator_publishing_autopost_source_fingerprint(content_package_id), 'co-performer mutation leaves source fingerprint current') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000007';
update public.creator_publishing_scheduler_events set status='processing', lock_token='90000000-0000-4000-8000-000000000007', locked_at=clock_timestamp(), updated_at=now() where platform_job_id='80000000-0000-4000-8000-000000000007' and schedule_revision=1 and event_type='publish_due';
select id as due_co_event_id from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000007' and schedule_revision=1 and event_type='publish_due' \gset
select public.creator_publishing_process_scheduler_event(:'due_co_event_id'::uuid,'90000000-0000-4000-8000-000000000007','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12') as due_co_result \gset
select public.task15_assert((:'due_co_result')::jsonb->>'safe_error_code'='CO_PERFORMER_RELEASE_MISSING' and (:'due_co_result')::jsonb->>'status'='blocked', 'co-performer release blocks processing');
select public.task15_assert(job_state='needs_fix' and job_state <> 'ready_for_export', 'co-performer release moves job to needs_fix') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000007';
select public.task15_assert(status='blocked' and safe_error_code='CO_PERFORMER_RELEASE_MISSING', 'co-performer event blocked with safe code') from public.creator_publishing_scheduler_events where id=:'due_co_event_id'::uuid;
select public.task15_assert((select count(*) from public.creator_publishing_audit_events where action='creator_publishing_scheduler_gate_failed' and entity_id=:'due_co_event_id'::uuid and after_state->>'safe_error_code'='CO_PERFORMER_RELEASE_MISSING')=1, 'co-performer audit records code');
select public.task15_assert(not exists(select 1 from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_processed' and entity_id=:'due_co_event_id'::uuid), 'co-performer gate writes no processed audit');

select public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000007',now()+interval '3 hours','UTC','due-compliance-schedule-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000008'::uuid],'{}','schedule');
insert into public.creator_publishing_compliance_reviews(content_package_id,reviewer_id,outcome,review_source,rule_hits,compliance_policy_version,created_at,review_metadata)
values ('30000000-0000-4000-8000-000000000007',null,'block','automated','[]'::jsonb,'policy-v1',now(),'{}'::jsonb);
select public.task15_assert((select creator_approval_status from public.creator_publishing_content_packages where id='30000000-0000-4000-8000-000000000007')='approved' and (select compliance_status from public.creator_publishing_content_packages where id='30000000-0000-4000-8000-000000000007')='passed', 'compliance fixture package remains approved passed');
select public.task15_assert(source_package_fingerprint=public.creator_publishing_autopost_source_fingerprint(content_package_id), 'compliance mutation leaves source fingerprint current') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000008';
update public.creator_publishing_scheduler_events set status='processing', lock_token='90000000-0000-4000-8000-000000000008', locked_at=clock_timestamp(), updated_at=now() where platform_job_id='80000000-0000-4000-8000-000000000008' and schedule_revision=1 and event_type='publish_due';
select id as due_compliance_event_id from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000008' and schedule_revision=1 and event_type='publish_due' \gset
select public.creator_publishing_process_scheduler_event(:'due_compliance_event_id'::uuid,'90000000-0000-4000-8000-000000000008','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12') as due_compliance_result \gset
select public.task15_assert((:'due_compliance_result')::jsonb->>'safe_error_code'='COMPLIANCE_EVIDENCE_INVALID' and (:'due_compliance_result')::jsonb->>'status'='blocked', 'later compliance block blocks processing');
select public.task15_assert(job_state='needs_fix' and job_state <> 'ready_for_export', 'compliance evidence moves job to needs_fix') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000008';
select public.task15_assert(status='blocked' and safe_error_code='COMPLIANCE_EVIDENCE_INVALID', 'compliance event blocked with safe code') from public.creator_publishing_scheduler_events where id=:'due_compliance_event_id'::uuid;
select public.task15_assert((select count(*) from public.creator_publishing_audit_events where action='creator_publishing_scheduler_gate_failed' and entity_id=:'due_compliance_event_id'::uuid and after_state->>'safe_error_code'='COMPLIANCE_EVIDENCE_INVALID')=1, 'compliance audit records code');
select public.task15_assert(not exists(select 1 from public.creator_publishing_audit_events where action='creator_publishing_scheduler_event_processed' and entity_id=:'due_compliance_event_id'::uuid), 'compliance gate writes no processed audit');

select public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000008',now()+interval '3 hours','UTC','due-publication-conflict-schedule-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000009'::uuid],'{}','schedule');
begin;
drop index public.creator_publishing_jobs_active_package_uidx;
insert into public.creator_publishing_plans(id,creator_id,status,idempotency_key,request_fingerprint,registry_version,created_at,updated_at)
values ('70000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000001','draft','due-conflict-temp-plan-key-0001','9999999999999999999999999999999999999999999999999999999999999998','task14.20260711.001',now(),now());
insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,created_at,updated_at)
values ('80000000-0000-4000-8000-000000000010','70000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000004','fansly','planner','draft',(select updated_at from public.creator_publishing_content_packages where id='30000000-0000-4000-8000-000000000008'),public.creator_publishing_autopost_source_fingerprint('30000000-0000-4000-8000-000000000008'),'task14.20260711.001','9999999999999999999999999999999999999999999999999999999999999997',now(),now());
update public.creator_publishing_scheduler_events set status='processing', lock_token='90000000-0000-4000-8000-000000000009', locked_at=clock_timestamp(), updated_at=now() where platform_job_id='80000000-0000-4000-8000-000000000009' and schedule_revision=1 and event_type='publish_due';
select id as due_conflict_event_id from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000009' and schedule_revision=1 and event_type='publish_due' \gset
select public.creator_publishing_process_scheduler_event(:'due_conflict_event_id'::uuid,'90000000-0000-4000-8000-000000000009','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12') as due_conflict_result \gset
select public.task15_assert((:'due_conflict_result')::jsonb->>'safe_error_code'='ACTIVE_PUBLICATION_JOB_CONFLICT' and (:'due_conflict_result')::jsonb->>'status'='blocked', 'publication conflict blocks processing');
select public.task15_assert(job_state='blocked' and job_state <> 'ready_for_export', 'publication conflict blocks target job') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000009';
select public.task15_assert(status='blocked' and safe_error_code='ACTIVE_PUBLICATION_JOB_CONFLICT', 'publication conflict event blocked with code') from public.creator_publishing_scheduler_events where id=:'due_conflict_event_id'::uuid;
select public.task15_assert((select count(*) from public.creator_publishing_audit_events where action='creator_publishing_scheduler_gate_failed' and entity_id=:'due_conflict_event_id'::uuid and after_state->>'safe_error_code'='ACTIVE_PUBLICATION_JOB_CONFLICT')=1, 'publication conflict audit records code');
rollback;
select public.task15_assert(to_regclass('public.creator_publishing_jobs_active_package_uidx') is not null, 'active package unique index restored after rollback');
select public.task15_assert(not exists(select 1 from public.creator_publishing_plans where id='70000000-0000-4000-8000-000000000009') and not exists(select 1 from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000010'), 'temporary conflict plan and job rolled back');
select public.task15_assert(job_state='package_ready' and schedule_revision=1, 'publication conflict rollback restores target job') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000009';
select public.task15_assert(status='pending', 'publication conflict rollback restores target event') from public.creator_publishing_scheduler_events where id=:'due_conflict_event_id'::uuid;

select public.task15_assert(has_table_privilege('anon','public.creator_publishing_scheduler_events','select') is false, 'anon has no scheduler event table select');
select public.task15_assert(has_table_privilege('authenticated','public.creator_publishing_scheduler_idempotency','select') is false, 'authenticated has no scheduler idempotency table select');
select public.task15_assert(has_function_privilege('authenticated','public.creator_publishing_schedule_plan(uuid,uuid,timestamp with time zone,text,text,text,text,uuid[],jsonb,text)','execute') is false, 'authenticated cannot execute schedule rpc');

\echo 'Task 15 integration assertions completed'
