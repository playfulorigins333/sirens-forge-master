\set ON_ERROR_STOP on
-- All source families materialize, while stale prior lifecycle milestones suppress.
insert into public.creator_data_exports values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','completed',now()-interval '1 minute',now()+interval '1 day');
insert into public.account_deletion_requests values('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','reactivated',now()+interval '59 days',null,now()-interval '2 minutes',now()-interval '1 minute',null);
insert into public.subscription_cancellation_retentions values('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','superseded',now()-interval '60 days',now(),now()-interval '60 days',now()-interval '30 days',now()-interval '15 days',now()-interval '5 days');
insert into public.subscription_payment_delinquencies values('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','recovered',now()-interval '60 days',now(),now()-interval '60 days',now()-interval '30 days',now()-interval '15 days',now()-interval '5 days');
do $$ declare n integer; rows integer; tok uuid:=gen_random_uuid(); nid uuid; begin
 n:=public.materialize_phase9_notifications(100); if n<>11 then raise exception 'expected 11 materialized, got %',n; end if;
 if public.materialize_phase9_notifications(100)<>0 then raise exception 'idempotency failed'; end if;
 select count(*) into rows from public.claim_phase9_notifications(tok,50); if rows<>2 then raise exception 'valid claim/stale suppression failed: %',rows; end if;
 select id into nid from public.transactional_notification_deliveries where state='claimed' limit 1;
 if not public.mark_phase9_notification_attempt_started(nid,tok) then raise exception 'attempt start failed'; end if;
 if not public.finalize_phase9_notification(nid,tok,'delivered',null,repeat('a',64)) then raise exception 'finalize failed'; end if;
 if public.finalize_phase9_notification(nid,tok,'delivered',null,repeat('a',64)) then raise exception 'duplicate finalize accepted'; end if;
 if exists(select 1 from public.claim_phase9_notifications(gen_random_uuid(),50) where id=nid) then raise exception 'delivered reclaimed'; end if;
 if (select count(*) from public.transactional_notification_deliveries where state='suppressed' and terminal_reason='source_stale')<>9 then raise exception 'stale work not suppressed'; end if;
end $$;

-- Starvation regression: an old existing identity is filtered before LIMIT, and
-- repeated bounded runs drain all newer work while uniqueness remains enforced.
truncate public.transactional_notification_deliveries;
truncate public.creator_data_exports;
truncate public.account_deletion_requests,public.subscription_cancellation_retentions,public.subscription_payment_delinquencies;
insert into public.creator_data_exports(id,auth_user_id,status,ready_notification_due_at,expires_at)
select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000001','completed',now()-interval '10 minutes'+n*interval '1 second',now()+interval '1 day' from generate_series(1,5) n;
insert into public.transactional_notification_deliveries(source_type,source_id,notification_kind,auth_user_id,due_at,next_attempt_at)
select 'creator_data_export',id,'export_ready',auth_user_id,ready_notification_due_at,ready_notification_due_at from public.creator_data_exports order by ready_notification_due_at limit 1;
do $$ begin
 if public.materialize_phase9_notifications(2)<>2 then raise exception 'existing old row consumed bounded limit'; end if;
 if not exists(select 1 from public.transactional_notification_deliveries where source_id='30000000-0000-4000-8000-000000000003') then raise exception 'newer candidate was starved'; end if;
 if public.materialize_phase9_notifications(2)<>2 then raise exception 'bounded backlog did not drain'; end if;
 if public.materialize_phase9_notifications(2)<>0 then raise exception 'drained backlog not idempotent'; end if;
 if (select count(*) from public.transactional_notification_deliveries)<>5 then raise exception 'unique backlog cardinality incorrect'; end if;
 begin
  insert into public.transactional_notification_deliveries(source_type,source_id,notification_kind,auth_user_id,due_at,next_attempt_at)
  select source_type,source_id,notification_kind,auth_user_id,due_at,next_attempt_at from public.transactional_notification_deliveries limit 1;
  raise exception 'unique identity accepted duplicate';
 exception when unique_violation then null; end;
end $$;

-- A batch lease can expire partway through: provider-started work becomes
-- deliberately uncertain, but never-attempted work requeues and is reclaimed.
truncate public.transactional_notification_deliveries;
select public.materialize_phase9_notifications(5);
do $$ declare first_token uuid:=gen_random_uuid(); second_token uuid:=gen_random_uuid(); attempted uuid; unattempted uuid; reclaimed integer; begin
 select id into attempted from public.claim_phase9_notifications(first_token,2) order by id limit 1;
 select id into unattempted from public.transactional_notification_deliveries where lease_token=first_token and id<>attempted limit 1;
 if attempted is null or attempted=unattempted then raise exception 'multi-row claim failed'; end if;
 if not public.mark_phase9_notification_attempt_started(attempted,first_token) then raise exception 'attempt marker failed'; end if;
 update public.transactional_notification_deliveries set lease_expires_at=clock_timestamp()-interval '1 second' where lease_token=first_token;
 select count(*) into reclaimed from public.claim_phase9_notifications(second_token,2) where id=unattempted;
 if reclaimed<>1 then raise exception 'never-attempted expired claim was not reclaimed'; end if;
 if not exists(select 1 from public.transactional_notification_deliveries where id=attempted and state='failed_uncertain' and terminal_reason='provider_outcome_uncertain') then raise exception 'started uncertain attempt not terminalized deliberately'; end if;
 if exists(select 1 from public.transactional_notification_deliveries where id=attempted and lease_token=second_token) then raise exception 'uncertain attempt reclaimed'; end if;
end $$;

set role anon; do $$ begin perform public.claim_phase9_notifications(gen_random_uuid(),1); raise exception 'anon claim unexpectedly allowed'; exception when insufficient_privilege then null; end $$; reset role;
set role authenticated; do $$ begin update public.transactional_notification_deliveries set state='delivered'; raise exception 'authenticated mutation unexpectedly allowed'; exception when insufficient_privilege then null; end $$; reset role;

-- Durable notification evidence cannot block the Phase 7 account-deletion
-- authority from removing an Auth row.
insert into public.transactional_notification_deliveries(source_type,source_id,notification_kind,auth_user_id,due_at,next_attempt_at)
values('account_deletion','40000000-0000-4000-8000-000000000001','deletion_completed','10000000-0000-4000-8000-000000000002',now(),now());
delete from auth.users where id='10000000-0000-4000-8000-000000000002';
do $$ begin if not exists(select 1 from public.transactional_notification_deliveries where auth_user_id='10000000-0000-4000-8000-000000000002') then raise exception 'account deletion erased notification evidence'; end if; end $$;

-- Left unmaterialized for the runner's two-session concurrency assertion.
insert into public.creator_data_exports(id,auth_user_id,status,ready_notification_due_at,expires_at)
values('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','completed',now()-interval '1 minute',now()+interval '1 day');
