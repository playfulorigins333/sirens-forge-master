\set ON_ERROR_STOP on

-- Existing profiles become active without destructive backfill.
do $$begin
  if (select count(*) from public.profiles where account_lifecycle_state='active') <> 3 then
    raise exception 'existing profiles were not safely backfilled active';
  end if;
end$$;

-- Tables are service-role only; browser roles get no direct access.
do $$begin
  if has_table_privilege('authenticated','public.creator_data_exports','SELECT')
     or has_table_privilege('authenticated','public.account_deletion_requests','SELECT')
     or has_table_privilege('authenticated','public.account_deletion_protected_subjects','SELECT') then
    raise exception 'authenticated role unexpectedly has direct data-rights table access';
  end if;
  if not has_table_privilege('service_role','public.creator_data_exports','SELECT') then
    raise exception 'service role missing export access';
  end if;
end$$;

-- Export request is owner-bound and deduplicates while nonterminal.
select * from public.request_creator_data_export('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
select * from public.request_creator_data_export('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
do $$begin
  if (select count(*) from public.creator_data_exports where auth_user_id='10000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'nonterminal export request was not deduplicated';
  end if;
end$$;

-- Claim, stale-claim recovery, completion, and Phase 9 ready marker.
select * from public.claim_creator_data_export(
  (select id from public.creator_data_exports where auth_user_id='10000000-0000-4000-8000-000000000001'),
  '10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001');
update public.creator_data_exports set processing_started_at=now()-interval '16 minutes'
where auth_user_id='10000000-0000-4000-8000-000000000001';
select * from public.claim_creator_data_export(
  (select id from public.creator_data_exports where auth_user_id='10000000-0000-4000-8000-000000000001'),
  '10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002');
select * from public.complete_creator_data_export(
  (select id from public.creator_data_exports where auth_user_id='10000000-0000-4000-8000-000000000001'),
  '10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002',
  'creator-private','creator-exports/10000000-0000-4000-8000-000000000001/export.zip',1234,
  repeat('a',64),now()+interval '7 days');
do $$begin
  if not exists(select 1 from public.creator_data_exports where auth_user_id='10000000-0000-4000-8000-000000000001' and status='completed' and ready_notification_due_at is not null) then
    raise exception 'export completion or notification handoff missing';
  end if;
end$$;

-- Active renewable billing must already be set to cancel before voluntary deletion.
do $$begin
  begin
    perform * from public.request_voluntary_account_deletion(
      '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
      'export_before_deletion',(select id from public.creator_data_exports where auth_user_id='10000000-0000-4000-8000-000000000001'),
      'delete-my-account-v1','50000000-0000-4000-8000-000000000001');
    raise exception 'billing-active deletion unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%ACCOUNT_DELETION_BILLING_ACTIVE%' then raise; end if;
  end;
end$$;
update public.user_subscriptions set cancel_at_period_end=true where id='30000000-0000-4000-8000-000000000001';

select * from public.request_voluntary_account_deletion(
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  'export_before_deletion',(select id from public.creator_data_exports where auth_user_id='10000000-0000-4000-8000-000000000001'),
  'delete-my-account-v1','50000000-0000-4000-8000-000000000001');
do $$begin
  if not exists(select 1 from public.profiles where id='20000000-0000-4000-8000-000000000001' and account_lifecycle_state='voluntary_deletion_pending') then
    raise exception 'account was not frozen';
  end if;
  if not exists(select 1 from public.account_deletion_requests where auth_user_id='10000000-0000-4000-8000-000000000001' and status='pending' and recovery_deadline between requested_at+interval '59 days 23 hours' and requested_at+interval '60 days 1 hour' and requested_notification_due_at is not null) then
    raise exception '60 day deletion receipt or notification handoff missing';
  end if;
end$$;

-- Skip-export path and reactivation restore active state before deadline.
select * from public.request_voluntary_account_deletion(
  '10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003',
  'skip_export',null,'delete-my-account-v1','50000000-0000-4000-8000-000000000003');
select * from public.reactivate_voluntary_account_deletion(
  '10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003',
  '60000000-0000-4000-8000-000000000003');
do $$begin
  if not exists(select 1 from public.profiles where id='20000000-0000-4000-8000-000000000003' and account_lifecycle_state='active') then
    raise exception 'reactivation did not restore active state';
  end if;
  if not exists(select 1 from public.account_deletion_requests where auth_user_id='10000000-0000-4000-8000-000000000003' and status='reactivated' and reactivated_notification_due_at is not null) then
    raise exception 'reactivation receipt or notification handoff missing';
  end if;
end$$;

-- Protected subject cannot enter deletion.
insert into public.account_deletion_protected_subjects(auth_user_id,reason)
values('10000000-0000-4000-8000-000000000002','test_protected_subject');
do $$begin
  begin
    perform * from public.request_voluntary_account_deletion(
      '10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',
      'skip_export',null,'delete-my-account-v1','50000000-0000-4000-8000-000000000002');
    raise exception 'protected deletion unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%ACCOUNT_DELETION_PROTECTED_ACCOUNT%' then raise; end if;
  end;
end$$;

-- Raw RPC execution remains service-role only.
do $$begin
  if has_function_privilege('authenticated','public.request_creator_data_export(uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.request_voluntary_account_deletion(uuid,uuid,text,uuid,text,uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.request_creator_data_export(uuid,uuid)','EXECUTE') then
    raise exception 'data-rights RPC privilege boundary invalid';
  end if;
end$$;
