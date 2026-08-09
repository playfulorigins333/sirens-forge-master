begin;

create function public.get_my_affiliate_ledger_summary()
returns table(
  id uuid,
  commission_amount_cents integer,
  status text,
  created_at timestamptz,
  is_initial_payment_v2_purchase boolean,
  is_void_self_referral boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  affiliate_profile_id uuid;
  profile_count bigint;
begin
  if caller_id is null then
    raise exception 'authentication_required';
  end if;

  select count(*), (array_agg(p.id order by p.id))[1]
    into profile_count, affiliate_profile_id
    from public.profiles p
   where p.user_id = caller_id;

  if profile_count <> 1 or affiliate_profile_id is null then
    raise exception 'affiliate_profile_unavailable';
  end if;

  return query
  select l.id,
         l.commission_amount_cents,
         l.status,
         l.created_at,
         l.payment_v2_purchase_id is not null,
         coalesce(l.attribution_status = 'VOID_SELF_REFERRAL', false)
    from public.affiliate_ledger l
   where l.affiliate_user_id = affiliate_profile_id
   order by l.created_at desc, l.id desc;
end
$$;

alter function public.get_my_affiliate_ledger_summary() owner to postgres;
revoke all on function public.get_my_affiliate_ledger_summary() from public, anon, service_role;
grant execute on function public.get_my_affiliate_ledger_summary() to authenticated;

revoke select (
  id, affiliate_user_id, referred_user_id, commission_amount_cents,
  gross_amount_cents, commission_percent, status, created_at, updated_at,
  payment_v2_purchase_id, referral_code_id, referrer_affiliate_tier,
  attribution_status, void_reason, voided_at, payment_v2_recurring_invoice_id
) on public.affiliate_ledger from service_role;

create or replace function public.payment_v2_affiliate_public_cutover_ready()returns boolean language sql stable security definer set search_path=pg_catalog,pg_temp as $$select
 to_regclass('public.payment_v2_affiliate_recurring_invoices') is not null
 and coalesce((select c.relrowsecurity from pg_catalog.pg_class c where c.oid=to_regclass('public.payment_v2_affiliate_recurring_invoices')),false)
 and to_regprocedure('public.payment_v2_record_paid_with_charge(uuid,bytea,text,text,text,text,text,text,timestamp with time zone,integer,text,text,text,text)') is not null
 and to_regprocedure('public.payment_v2_reconcile_paid_invoices(uuid,text,text,text,text,jsonb)') is not null
 and to_regprocedure('public.prepare_affiliate_payout_batch(text)') is not null
 and to_regprocedure('public.payment_v2_get_payout_recurring_context(uuid)') is not null
 and to_regprocedure('public.payment_v2_begin_payout_dispatch(uuid)') is not null
 and to_regprocedure('public.complete_affiliate_payout_item(uuid,text)') is not null
 and to_regprocedure('public.fail_affiliate_payout_item(uuid,text)') is not null
 and not has_table_privilege('anon','public.affiliate_balances','SELECT')
 and not has_table_privilege('authenticated','public.affiliate_balances','SELECT')
 and not has_table_privilege('anon','public.payment_v2_affiliate_recurring_invoices','SELECT')
 and not has_table_privilege('authenticated','public.payment_v2_affiliate_recurring_invoices','SELECT')
 and coalesce(has_function_privilege('service_role',to_regprocedure('public.payment_v2_record_paid_with_charge(uuid,bytea,text,text,text,text,text,text,timestamp with time zone,integer,text,text,text,text)'),'EXECUTE'),false)
 and coalesce(has_function_privilege('service_role',to_regprocedure('public.payment_v2_reconcile_paid_invoices(uuid,text,text,text,text,jsonb)'),'EXECUTE'),false)
 and coalesce(has_function_privilege('service_role',to_regprocedure('public.prepare_affiliate_payout_batch(text)'),'EXECUTE'),false)
 and coalesce(has_function_privilege('service_role',to_regprocedure('public.payment_v2_get_payout_recurring_context(uuid)'),'EXECUTE'),false)
 and coalesce(has_function_privilege('service_role',to_regprocedure('public.payment_v2_begin_payout_dispatch(uuid)'),'EXECUTE'),false)
 and coalesce(has_function_privilege('service_role',to_regprocedure('public.complete_affiliate_payout_item(uuid,text)'),'EXECUTE'),false)
 and coalesce(has_function_privilege('service_role',to_regprocedure('public.fail_affiliate_payout_item(uuid,text)'),'EXECUTE'),false)
 and not coalesce(has_function_privilege('anon',to_regprocedure('public.payment_v2_reconcile_paid_invoices(uuid,text,text,text,text,jsonb)'),'EXECUTE'),false)
 and not coalesce(has_function_privilege('authenticated',to_regprocedure('public.payment_v2_reconcile_paid_invoices(uuid,text,text,text,text,jsonb)'),'EXECUTE'),false)
 and not coalesce(has_function_privilege('anon',to_regprocedure('public.prepare_affiliate_payout_batch(text)'),'EXECUTE'),false)
 and not coalesce(has_function_privilege('authenticated',to_regprocedure('public.prepare_affiliate_payout_batch(text)'),'EXECUTE'),false)
 and not coalesce(has_function_privilege('anon',to_regprocedure('public.payment_v2_get_payout_recurring_context(uuid)'),'EXECUTE'),false)
 and not coalesce(has_function_privilege('authenticated',to_regprocedure('public.payment_v2_get_payout_recurring_context(uuid)'),'EXECUTE'),false)
 and not coalesce(has_function_privilege('anon',to_regprocedure('public.payment_v2_begin_payout_dispatch(uuid)'),'EXECUTE'),false)
 and not coalesce(has_function_privilege('authenticated',to_regprocedure('public.payment_v2_begin_payout_dispatch(uuid)'),'EXECUTE'),false)
 and not coalesce(has_function_privilege('anon',to_regprocedure('public.complete_affiliate_payout_item(uuid,text)'),'EXECUTE'),false)
 and not coalesce(has_function_privilege('authenticated',to_regprocedure('public.complete_affiliate_payout_item(uuid,text)'),'EXECUTE'),false)
 and not coalesce(has_function_privilege('anon',to_regprocedure('public.fail_affiliate_payout_item(uuid,text)'),'EXECUTE'),false)
 and not coalesce(has_function_privilege('authenticated',to_regprocedure('public.fail_affiliate_payout_item(uuid,text)'),'EXECUTE'),false)
 and to_regprocedure('public.get_my_affiliate_ledger_summary()') is not null
 and coalesce(has_function_privilege('authenticated',to_regprocedure('public.get_my_affiliate_ledger_summary()'),'EXECUTE'),false)
 and not coalesce(has_function_privilege('anon',to_regprocedure('public.get_my_affiliate_ledger_summary()'),'EXECUTE'),false)
 and not coalesce(has_function_privilege('service_role',to_regprocedure('public.get_my_affiliate_ledger_summary()'),'EXECUTE'),false)
 and not exists(select 1 from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a where p.oid=to_regprocedure('public.get_my_affiliate_ledger_summary()') and a.grantee=0 and a.privilege_type='EXECUTE')
 and not exists(select 1 from pg_catalog.pg_attribute a where a.attrelid='public.affiliate_ledger'::regclass and a.attnum>0 and not a.attisdropped and (has_column_privilege('service_role','public.affiliate_ledger',a.attname,'SELECT') or has_column_privilege('authenticated','public.affiliate_ledger',a.attname,'SELECT') or has_column_privilege('anon','public.affiliate_ledger',a.attname,'SELECT')))
$$;
alter function public.payment_v2_affiliate_public_cutover_ready() owner to postgres;
revoke all on function public.payment_v2_affiliate_public_cutover_ready() from public, anon, authenticated;
grant execute on function public.payment_v2_affiliate_public_cutover_ready() to service_role;

select pg_notify('pgrst', 'reload schema');
commit;
