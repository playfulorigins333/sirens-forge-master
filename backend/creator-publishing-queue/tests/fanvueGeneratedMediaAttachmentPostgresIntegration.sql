create or replace function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$ begin if value is not true then raise exception 'ASSERTION_FAILED:%',label; end if; end $$;
create or replace function pg_temp.public_execute_granted(signature regprocedure) returns boolean language sql stable as $$ select exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=signature and a.grantee=0 and a.privilege_type='EXECUTE') $$;

select pg_temp.assert_true(
  (select count(*) = 1 from public.creator_publishing_content_packages where creator_id='11111111-1111-4111-8111-111111111111' and target_platform='fanvue' and creator_approval_status='pending'),
  'owned pending Fanvue package fixture exists'
);

create temp table fanvue_media_attach as
select public.creator_publishing_attach_generated_media(
  '11111111-1111-4111-8111-111111111111',
  (select id from public.creator_publishing_content_packages where creator_id='11111111-1111-4111-8111-111111111111' and target_platform='fanvue' limit 1),
  '77777777-7777-4777-8777-777777777771',
  'generated/11111111-1111-4111-8111-111111111111/fanvue/test-image.png',
  'image/png',
  12345,
  repeat('a',64),
  'image',
  '2026-08-17T00:00:00Z'::timestamptz,
  'standard'
) result;

select pg_temp.assert_true(
  (select result->'error' is null and (result->>'idempotent')::boolean is false from fanvue_media_attach),
  'owned unlocked Fanvue package accepts generated media'
);
select pg_temp.assert_true(
  (select count(*)=1 from public.creator_publishing_media_assets m join public.creator_publishing_content_packages p on p.id=m.content_package_id where p.target_platform='fanvue' and m.source='ai_pipeline' and m.ai_generation_metadata->>'generation_id'='77777777-7777-4777-8777-777777777771'),
  'Fanvue generated media asset inserted once'
);
select pg_temp.assert_true(
  (select count(*)=1 from public.creator_publishing_audit_events where action='generated_media_attached' and idempotency_key=(select id::text || ':77777777-7777-4777-8777-777777777771' from public.creator_publishing_content_packages where creator_id='11111111-1111-4111-8111-111111111111' and target_platform='fanvue' limit 1)),
  'Fanvue generated media audit event recorded'
);

create temp table fanvue_media_replay as
select public.creator_publishing_attach_generated_media(
  '11111111-1111-4111-8111-111111111111',
  (select id from public.creator_publishing_content_packages where creator_id='11111111-1111-4111-8111-111111111111' and target_platform='fanvue' limit 1),
  '77777777-7777-4777-8777-777777777771',
  'generated/11111111-1111-4111-8111-111111111111/fanvue/test-image.png',
  'image/png',
  12345,
  repeat('a',64),
  'image',
  '2026-08-17T00:00:00Z'::timestamptz,
  'standard'
) result;
select pg_temp.assert_true((select (result->>'idempotent')::boolean is true from fanvue_media_replay),'exact Fanvue media replay is idempotent');
select pg_temp.assert_true((select count(*)=1 from public.creator_publishing_media_assets where ai_generation_metadata->>'generation_id'='77777777-7777-4777-8777-777777777771'),'replay creates no duplicate media');

create temp table fanvue_media_wrong_owner as
select public.creator_publishing_attach_generated_media(
  '22222222-2222-4222-8222-222222222222',
  (select id from public.creator_publishing_content_packages where creator_id='11111111-1111-4111-8111-111111111111' and target_platform='fanvue' limit 1),
  '77777777-7777-4777-8777-777777777772',
  'generated/other/fanvue/wrong-owner.png','image/png',100,repeat('b',64),'image',clock_timestamp(),'standard'
) result;
select pg_temp.assert_true((select result->'error'->>'code'='NOT_FOUND' from fanvue_media_wrong_owner),'cross-creator Fanvue package remains hidden');

update public.creator_publishing_content_packages
set creator_approval_status='approved',creator_approved_by=creator_id,creator_approved_at=clock_timestamp()
where creator_id='11111111-1111-4111-8111-111111111111' and target_platform='fanvue';
create temp table fanvue_media_locked as
select public.creator_publishing_attach_generated_media(
  '11111111-1111-4111-8111-111111111111',
  (select id from public.creator_publishing_content_packages where creator_id='11111111-1111-4111-8111-111111111111' and target_platform='fanvue' limit 1),
  '77777777-7777-4777-8777-777777777773',
  'generated/11111111-1111-4111-8111-111111111111/fanvue/locked.png','image/png',100,repeat('c',64),'image',clock_timestamp(),'standard'
) result;
select pg_temp.assert_true((select result->'error'->>'code'='PACKAGE_LOCKED' from fanvue_media_locked),'approved Fanvue package remains media-locked');
update public.creator_publishing_content_packages
set creator_approval_status='pending',creator_approved_by=null,creator_approved_at=null
where creator_id='11111111-1111-4111-8111-111111111111' and target_platform='fanvue';

select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_platform_jobs where target_platform='fanvue'),'media preparation creates no Fanvue publishing job');
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_fanvue_attempts),'media preparation creates no Fanvue provider attempt');
select pg_temp.assert_true((select count(*)=0 from public.creator_publishing_scheduler_events),'media preparation creates no scheduler event');

do $$
declare
  sig regprocedure := 'public.creator_publishing_attach_generated_media(uuid,uuid,uuid,text,text,bigint,text,text,timestamptz,text)'::regprocedure;
  def text := lower(pg_get_functiondef(sig));
begin
  perform pg_temp.assert_true(position('security definer' in def)>0,'generated media RPC remains security definer');
  perform pg_temp.assert_true(position('v_package.creator_id <> p_creator_id' in def)>0,'generated media RPC retains owner guard');
  perform pg_temp.assert_true(position('creator_approval_status = ''approved''' in def)>0,'generated media RPC retains approval lock');
  perform pg_temp.assert_true(position('status <> ''archived''' in def)>0,'generated media RPC retains active task lock');
  perform pg_temp.assert_true(position('target_platform = ''fanvue''' in def)=0,'replacement RPC removes only Fanvue exclusion');
  perform pg_temp.assert_true(not pg_temp.public_execute_granted(sig),'PUBLIC execute remains revoked');
  perform pg_temp.assert_true(not has_function_privilege('anon',sig,'execute'),'anon execute remains revoked');
  perform pg_temp.assert_true(not has_function_privilege('authenticated',sig,'execute'),'authenticated execute remains revoked');
  perform pg_temp.assert_true(has_function_privilege('service_role',sig,'execute'),'service role execute remains granted');
end $$;

select 'FANVUE_GENERATED_MEDIA_ATTACHMENT_POSTGRES_ASSERTIONS_PASSED' result;
