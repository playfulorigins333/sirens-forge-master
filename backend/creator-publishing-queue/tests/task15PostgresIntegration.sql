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
('60000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','onlyfans','20000000-0000-4000-8000-000000000002','claimed',null,now(),now());

insert into public.creator_publishing_plans(id,creator_id,status,idempotency_key,request_fingerprint,registry_version,created_at,updated_at)
values
('70000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','draft','plan-key-0001','1111111111111111111111111111111111111111111111111111111111111111','task14.20260711.001',now(),now()),
('70000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','draft','plan-key-0002','2222222222222222222222222222222222222222222222222222222222222222','task14.20260711.001',now(),now()),
('70000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','draft','plan-key-0003','3333333333333333333333333333333333333333333333333333333333333333','task14.20260711.001',now(),now());

insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint,created_at,updated_at)
values
('80000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','onlyfans','assisted','draft',(select updated_at from public.creator_publishing_content_packages where id='30000000-0000-4000-8000-000000000001'),public.creator_publishing_autopost_source_fingerprint('30000000-0000-4000-8000-000000000001'),'task14.20260711.001','1111111111111111111111111111111111111111111111111111111111111111',now(),now()),
('80000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','onlyfans','assisted','draft',(select updated_at from public.creator_publishing_content_packages where id='30000000-0000-4000-8000-000000000002'),public.creator_publishing_autopost_source_fingerprint('30000000-0000-4000-8000-000000000002'),'task14.20260711.001','1111111111111111111111111111111111111111111111111111111111111111',now(),now());

select public.task15_assert(schedule_revision is null and intended_publish_at is null, 'unscheduled draft revision is null') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';

select now() + interval '3 hours' as schedule_intended_publish_at \gset
select public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',:'schedule_intended_publish_at'::timestamptz,'UTC','schedule-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000001'::uuid,'80000000-0000-4000-8000-000000000002'::uuid],'{}','schedule') as schedule_result \gset
select public.task15_assert(((:'schedule_result')::jsonb->>'success_count')::int = 1, 'per-destination isolation lets compatible destination succeed');
select public.task15_assert(((:'schedule_result')::jsonb->>'failure_count')::int = 1, 'per-destination isolation returns failed destination');
select public.task15_assert(schedule_revision=1 and job_state='scheduled_internally' and operator_due_at = intended_publish_at - interval '60 minutes', 'assisted schedule fields set') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert(schedule_revision is null and job_state='draft', 'failed queue-conflict destination not mutated') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000002';
select public.task15_assert(count(*)=2, 'assisted schedule creates two events') from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000001';
select public.task15_assert(not exists(select 1 from public.creator_publishing_queue_tasks where id='60000000-0000-4000-8000-000000000001' and status <> 'ready_for_handoff'), 'queue rows not mutated');

select public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',:'schedule_intended_publish_at'::timestamptz,'UTC','schedule-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000001'::uuid,'80000000-0000-4000-8000-000000000002'::uuid],'{}','schedule') as replay_result \gset
select public.task15_assert(((:'replay_result')::jsonb->>'success_count')::int = 1, 'idempotent replay returns stored result');

do $$ begin
  begin
    perform public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',now()+interval '4 hours','UTC','schedule-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000001'::uuid],'{}','schedule');
    raise exception 'expected idempotency conflict';
  exception when others then
    if sqlerrm not like '%IDEMPOTENCY_CONFLICT%' then raise; end if;
  end;
end $$;

select public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',now()+interval '5 hours','UTC','reschedule-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000001'::uuid],jsonb_build_object('80000000-0000-4000-8000-000000000001',1),'reschedule') as reschedule_result \gset
select public.task15_assert(schedule_revision=2, 'reschedule increments revision') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert(count(*)=2, 'prior events superseded') from public.creator_publishing_scheduler_events where platform_job_id='80000000-0000-4000-8000-000000000001' and status='superseded';

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

select public.creator_publishing_cancel_job_schedule('00000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','Task 15 terminal cancellation fixture','cancel-job-key-0001') as cancel_job_result \gset
select public.task15_assert((:'cancel_job_result')::jsonb->>'ok' = 'true', 'terminal job cancellation succeeds');
select public.task15_assert(job_state='direct_publish_failed', 'terminal job cancellation preserves direct_publish_failed') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert(job_state <> 'archived', 'terminal job cancellation does not archive') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert(cancelled_at is null and cancelled_by is null and cancellation_reason is null, 'terminal job cancellation metadata remains unchanged') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert((select before_state->>'job_state' from public.creator_publishing_audit_events where action='creator_publishing_job_schedule_cancelled' and entity_id='80000000-0000-4000-8000-000000000001' order by id desc limit 1)='direct_publish_failed', 'terminal job cancel audit before state truthful');
select public.task15_assert((select after_state->>'job_state' from public.creator_publishing_audit_events where action='creator_publishing_job_schedule_cancelled' and entity_id='80000000-0000-4000-8000-000000000001' order by id desc limit 1)='direct_publish_failed', 'terminal job cancel audit after state truthful');
select public.task15_assert((select after_state->>'reason' from public.creator_publishing_audit_events where action='creator_publishing_job_schedule_cancelled' and entity_id='80000000-0000-4000-8000-000000000001' order by id desc limit 1)='Task 15 terminal cancellation fixture', 'terminal job cancel audit reason truthful');

select public.creator_publishing_cancel_plan_schedule('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','Task 15 plan cancellation fixture','cancel-plan-key-0001') as cancel_plan_result \gset
select public.task15_assert((select status from public.creator_publishing_plans where id='70000000-0000-4000-8000-000000000001')='cancelled', 'plan cancellation marks plan cancelled');
select public.task15_assert(job_state='direct_publish_failed', 'plan cancellation preserves terminal failed job') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert(job_state='archived', 'plan cancellation archives nonterminal job') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000002';
select public.task15_assert(cancellation_reason='Task 15 plan cancellation fixture', 'plan cancellation reason applied to archived nonterminal job') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000002';
select public.task15_assert(cancelled_at is null and cancelled_by is null and cancellation_reason is null, 'plan cancellation does not replace terminal job metadata') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000001';
select public.task15_assert((select after_state->>'status' from public.creator_publishing_audit_events where action='creator_publishing_schedule_cancelled' and entity_id='70000000-0000-4000-8000-000000000001' order by id desc limit 1)='cancelled', 'plan cancel audit status');
select public.task15_assert((select after_state->>'reason' from public.creator_publishing_audit_events where action='creator_publishing_schedule_cancelled' and entity_id='70000000-0000-4000-8000-000000000001' order by id desc limit 1)='Task 15 plan cancellation fixture', 'plan cancel audit reason');

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
select public.creator_publishing_schedule_plan('00000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000003',now()+interval '3 hours','UTC','planner-key-0001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12',array['80000000-0000-4000-8000-000000000004'::uuid],'{}','schedule');
select public.task15_assert(job_state='package_ready', 'planner schedule stops at package_ready') from public.creator_publishing_platform_jobs where id='80000000-0000-4000-8000-000000000004';

select public.task15_assert(has_table_privilege('anon','public.creator_publishing_scheduler_events','select') is false, 'anon has no scheduler event table select');
select public.task15_assert(has_table_privilege('authenticated','public.creator_publishing_scheduler_idempotency','select') is false, 'authenticated has no scheduler idempotency table select');
select public.task15_assert(has_function_privilege('authenticated','public.creator_publishing_schedule_plan(uuid,uuid,timestamp with time zone,text,text,text,text,uuid[],jsonb,text)','execute') is false, 'authenticated cannot execute schedule rpc');

\echo 'Task 15 integration assertions completed'
