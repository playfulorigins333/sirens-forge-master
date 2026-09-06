\set ON_ERROR_STOP on
insert into public.creator_data_exports values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','completed',now()-interval '1 minute',now()+interval '1 day');
insert into public.account_deletion_requests values('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','reactivated',now()+interval '59 days',null,now()-interval '2 minutes',now()-interval '1 minute',null);
insert into public.subscription_cancellation_retentions values('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','superseded',now()-interval '60 days',now(),now()-interval '60 days',now()-interval '30 days',now()-interval '15 days',now()-interval '5 days');
insert into public.subscription_payment_delinquencies values('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','recovered',now()-interval '60 days',now(),now()-interval '60 days',now()-interval '30 days',now()-interval '15 days',now()-interval '5 days');
do $$ declare n integer; rows integer; tok uuid:=gen_random_uuid(); nid uuid; begin
 n:=public.materialize_phase9_notifications(100); if n<>11 then raise exception 'expected 11 materialized, got %',n; end if;
 if public.materialize_phase9_notifications(100)<>0 then raise exception 'idempotency failed'; end if;
 select count(*) into rows from public.claim_phase9_notifications(tok,50); if rows<>2 then raise exception 'valid claim/stale suppression failed: %',rows; end if;
 select id into nid from public.transactional_notification_deliveries where state='claimed' limit 1;
 if not public.finalize_phase9_notification(nid,tok,'delivered',null,repeat('a',64)) then raise exception 'finalize failed'; end if;
 if public.finalize_phase9_notification(nid,tok,'delivered',null,repeat('a',64)) then raise exception 'duplicate finalize accepted'; end if;
 if exists(select 1 from public.claim_phase9_notifications(gen_random_uuid(),50) where id=nid) then raise exception 'delivered reclaimed'; end if;
 if (select count(*) from public.transactional_notification_deliveries where state='suppressed' and terminal_reason='source_stale')<>9 then raise exception 'stale work not suppressed'; end if;
end $$;
set role anon; do $$ begin perform public.claim_phase9_notifications(gen_random_uuid(),1); raise exception 'anon claim unexpectedly allowed'; exception when insufficient_privilege then null; end $$; reset role;
set role authenticated; do $$ begin update public.transactional_notification_deliveries set state='delivered'; raise exception 'authenticated mutation unexpectedly allowed'; exception when insufficient_privilege then null; end $$; reset role;
