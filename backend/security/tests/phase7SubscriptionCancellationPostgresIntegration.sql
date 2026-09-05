\set ON_ERROR_STOP on
insert into auth.users(id) select ('10000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid from generate_series(1,6) g;
insert into public.profiles(id,user_id)
select ('20000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid,
       ('10000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid from generate_series(1,6) g;

-- Scheduled recurring cancellation: one idempotent pending lifecycle and exact marker offsets.
insert into public.user_subscriptions(id,user_id,status,tier_name,stripe_subscription_id,current_period_end,cancel_at_period_end)
values ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','active','early_bird','sub_1',now()+interval '10 days',true);
update public.user_subscriptions set cancel_at_period_end=true where id='30000000-0000-4000-8000-000000000001';
do $$declare r record; begin
 select * into strict r from public.subscription_cancellation_retentions where subscription_id='30000000-0000-4000-8000-000000000001';
 if r.state <> 'pending_paid_access_end' or r.retention_until <> r.paid_access_ends_at + interval '60 days'
   or r.day_0_notification_due_at <> r.paid_access_ends_at
   or r.day_30_notification_due_at <> r.paid_access_ends_at + interval '30 days'
   or r.day_45_notification_due_at <> r.paid_access_ends_at + interval '45 days'
   or r.day_55_notification_due_at <> r.paid_access_ends_at + interval '55 days' then raise exception 'scheduled cancellation contract failed'; end if;
 if (select count(*) from public.subscription_cancellation_retentions where subscription_id=r.subscription_id) <> 1 then raise exception 'retry duplicated lifecycle'; end if;
end$$;

-- Reversal preserves history; a later cancellation starts a distinct lifecycle.
update public.user_subscriptions set cancel_at_period_end=false where id='30000000-0000-4000-8000-000000000001';
do $$begin if not exists(select 1 from public.subscription_cancellation_retentions where subscription_id='30000000-0000-4000-8000-000000000001' and state='reactivated' and reactivated_at is not null) then raise exception 'reversal history missing'; end if; end$$;
update public.user_subscriptions set cancel_at_period_end=true where id='30000000-0000-4000-8000-000000000001';

-- Canceled snapshots use period end, not canceled observation time; elapsed periods retain read-only.
insert into public.user_subscriptions(id,user_id,status,tier_name,stripe_subscription_id,current_period_end,cancel_at_period_end)
values ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','canceled','early_bird','sub_2',now()-interval '2 days',false);
do $$begin if not exists(select 1 from public.subscription_cancellation_retentions where subscription_id='30000000-0000-4000-8000-000000000002' and state='retained_read_only' and retention_until=paid_access_ends_at+interval '60 days') then raise exception 'canceled boundary failed'; end if; end$$;

-- Expiry is a Phase 8-ready marker only; no content is purged here.
insert into public.user_subscriptions(id,user_id,status,tier_name,stripe_subscription_id,current_period_end,cancel_at_period_end)
values ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','canceled','early_bird','sub_3',now()-interval '61 days',false);
do $$begin if not exists(select 1 from public.subscription_cancellation_retentions where subscription_id='30000000-0000-4000-8000-000000000003' and state='expired') then raise exception 'expired handoff missing'; end if; end$$;

-- Delinquency and lifetime entitlement never enter this cancellation lifecycle.
insert into public.user_subscriptions(id,user_id,status,tier_name,stripe_subscription_id,current_period_end,cancel_at_period_end) values
 ('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000004','past_due','early_bird','sub_4',now()+interval '5 days',true),
 ('30000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000005','unpaid','early_bird','sub_5',now()+interval '5 days',true),
 ('30000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000006','active','og_throne',null,null,false);
do $$begin if exists(select 1 from public.subscription_cancellation_retentions where subscription_id in ('30000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000006')) then raise exception 'excluded entitlement retained'; end if; end$$;

-- Renewable exact +30-day extension, action-id idempotency, and preserved history.
do $$declare rid uuid; before_at timestamptz; after_at timestamptz; begin
 select id,retention_until into rid,before_at from public.subscription_cancellation_retentions where subscription_id='30000000-0000-4000-8000-000000000002';
 perform * from public.extend_subscription_cancellation_retention(rid,'support:test','verified hardship','40000000-0000-4000-8000-000000000001');
 select retention_until into after_at from public.subscription_cancellation_retentions where id=rid;
 if after_at <> before_at+interval '30 days' then raise exception 'first extension failed'; end if;
 perform * from public.extend_subscription_cancellation_retention(rid,'support:test','verified hardship','40000000-0000-4000-8000-000000000001');
 if (select retention_until from public.subscription_cancellation_retentions where id=rid) <> after_at then raise exception 'idempotency failed'; end if;
 perform * from public.extend_subscription_cancellation_retention(rid,'support:test','renewed hardship','40000000-0000-4000-8000-000000000002');
 if (select retention_until from public.subscription_cancellation_retentions where id=rid) <> after_at+interval '30 days' then raise exception 'renewal failed'; end if;
 if (select count(*) from public.subscription_retention_extensions where retention_id=rid) <> 2 then raise exception 'extension history failed'; end if;
end$$;

do $$begin
 if not (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.subscription_cancellation_retentions'::regclass) then raise exception 'retention RLS not forced'; end if;
 if has_table_privilege('anon','public.subscription_cancellation_retentions','select') or has_table_privilege('authenticated','public.subscription_cancellation_retentions','select') then raise exception 'retention table exposed'; end if;
 if has_function_privilege('authenticated','public.extend_subscription_cancellation_retention(uuid,text,text,uuid)','execute') then raise exception 'extension RPC exposed'; end if;
 if not has_function_privilege('service_role','public.extend_subscription_cancellation_retention(uuid,text,text,uuid)','execute') then raise exception 'service RPC missing'; end if;
end$$;

