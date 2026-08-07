-- Forward-only affiliate public-cutover hardening.
begin;

-- affiliate_balances is an aggregate SECURITY DEFINER view in the deployed
-- schema. It is server-only: browser roles must never be able to scan it.
do $acl$
begin
  if to_regclass('public.affiliate_balances') is null then
    raise exception 'PFC_CORE_03D_CATALOG_MISMATCH: missing public.affiliate_balances';
  end if;
  execute 'revoke all privileges on table public.affiliate_balances from public, anon, authenticated, service_role';
end
$acl$;

create table public.payment_v2_affiliate_subscription_lifecycles (
  payment_v2_purchase_id uuid primary key references public.payment_v2_purchases(id),
  stripe_subscription_id text not null unique,
  paid_month_count integer not null default 0 check (paid_month_count >= 0),
  last_paid_invoice_id text,
  target_commission_percent numeric not null check (target_commission_percent in (10,20,25,50)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_v2_affiliate_recurring_invoices (
  id uuid primary key default gen_random_uuid(),
  payment_v2_purchase_id uuid not null references public.payment_v2_purchases(id),
  stripe_subscription_id text not null,
  stripe_invoice_id text not null unique,
  stripe_event_id text not null unique,
  paid_month_number integer not null check (paid_month_number > 0),
  gross_amount_cents integer not null check (gross_amount_cents >= 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  commission_percent numeric,
  commission_amount_cents integer,
  commission_created boolean not null,
  created_at timestamptz not null default now(),
  check ((commission_created and commission_percent in (10,20,25,50) and commission_amount_cents >= 0)
      or (not commission_created and commission_percent is null and commission_amount_cents is null))
);

alter table public.affiliate_ledger add column payment_v2_recurring_invoice_id uuid
  references public.payment_v2_affiliate_recurring_invoices(id);
alter table public.affiliate_ledger drop constraint affiliate_ledger_payment_v2_attribution;
alter table public.affiliate_ledger add constraint affiliate_ledger_payment_v2_attribution check (
  (payment_v2_purchase_id is null and payment_v2_recurring_invoice_id is null and attribution_status is null and referrer_affiliate_tier is null)
  or (payment_v2_purchase_id is not null and payment_v2_recurring_invoice_id is null and referral_code_id is not null and referrer_affiliate_tier in ('og_throne','early_bird') and attribution_status in ('PURCHASER_UNCLAIMED','PURCHASER_ATTACHED','VOID_SELF_REFERRAL'))
  or (payment_v2_purchase_id is null and payment_v2_recurring_invoice_id is not null and referral_code_id is not null and referrer_affiliate_tier in ('og_throne','early_bird') and attribution_status='PURCHASER_ATTACHED')
);
create unique index affiliate_ledger_one_payment_v2_recurring_commission
  on public.affiliate_ledger(payment_v2_recurring_invoice_id)
  where payment_v2_recurring_invoice_id is not null;

alter table public.payment_v2_affiliate_subscription_lifecycles enable row level security;
alter table public.payment_v2_affiliate_recurring_invoices enable row level security;
revoke all privileges on public.payment_v2_affiliate_subscription_lifecycles,
  public.payment_v2_affiliate_recurring_invoices from public,anon,authenticated,service_role;

create function public.payment_v2_record_paid_recurring_invoice(
  p_hold_id uuid, p_subscription_id text, p_customer_id text, p_invoice_id text, p_provider_event_id text,
  p_billing_reason text, p_paid_at timestamptz, p_gross_amount_cents integer, p_currency text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  purchase public.payment_v2_purchases%rowtype;
  initial_ledger public.affiliate_ledger%rowtype;
  lifecycle public.payment_v2_affiliate_subscription_lifecycles%rowtype;
  invoice public.payment_v2_affiliate_recurring_invoices%rowtype;
  month_number integer;
  rate numeric;
  amount integer;
  created_commission boolean := false;
begin
  if btrim(coalesce(p_subscription_id,''))='' or btrim(coalesce(p_customer_id,''))=''
    or btrim(coalesce(p_invoice_id,''))='' or btrim(coalesce(p_provider_event_id,''))=''
    or p_billing_reason not in ('subscription_create','subscription_cycle')
    or p_paid_at is null or p_paid_at > now()+interval '5 minutes'
    or p_gross_amount_cents < 0 or lower(p_currency) !~ '^[a-z]{3}$' then
    raise exception 'invalid_recurring_invoice';
  end if;
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended('payment_v2_subscription:'||p_subscription_id,3200));
  select * into purchase from public.payment_v2_purchases p
    where p.hold_id=p_hold_id and p.stripe_subscription_id=p_subscription_id and p.tier='early_bird' and p.stripe_customer_id=p_customer_id;
  if not found then raise exception 'subscription_purchase_missing'; end if;
  select * into initial_ledger from public.affiliate_ledger l where l.payment_v2_purchase_id=purchase.id;
  if not found then
    return jsonb_build_object('status','no_attribution','paidMonth',null,'commissionPercent',null,'nextCommissionPercent',null);
  end if;
  select * into invoice from public.payment_v2_affiliate_recurring_invoices i where i.stripe_invoice_id=p_invoice_id or i.stripe_event_id=p_provider_event_id;
  if found then
    if invoice.stripe_invoice_id<>p_invoice_id or invoice.stripe_event_id<>p_provider_event_id or invoice.stripe_subscription_id<>p_subscription_id
      or invoice.gross_amount_cents<>p_gross_amount_cents or invoice.currency<>lower(p_currency) then raise exception 'recurring_invoice_conflict'; end if;
    select * into lifecycle from public.payment_v2_affiliate_subscription_lifecycles x where x.payment_v2_purchase_id=purchase.id;
    return jsonb_build_object('status','already_recorded','paidMonth',invoice.paid_month_number,'commissionPercent',invoice.commission_percent,
      'nextCommissionPercent',case when initial_ledger.status='void' then 0 else lifecycle.target_commission_percent end,'commissionCreated',invoice.commission_created);
  end if;
  select * into lifecycle from public.payment_v2_affiliate_subscription_lifecycles x where x.payment_v2_purchase_id=purchase.id for update;
  if not found then
    if p_billing_reason<>'subscription_create' then raise exception 'initial_invoice_missing'; end if;
    rate:=case when purchase.referrer_affiliate_tier='og_throne' then 50 else 20 end;
    insert into public.payment_v2_affiliate_subscription_lifecycles(payment_v2_purchase_id,stripe_subscription_id,paid_month_count,last_paid_invoice_id,target_commission_percent)
      values(purchase.id,p_subscription_id,1,p_invoice_id,rate) returning * into lifecycle;
    month_number:=1;
  else
    if p_billing_reason='subscription_create' then raise exception 'unexpected_initial_invoice'; end if;
    month_number:=lifecycle.paid_month_count+1;
    rate:=case when purchase.referrer_affiliate_tier='og_throne' then (case when month_number<=6 then 50 else 25 end)
      else (case when month_number<=6 then 20 else 10 end) end;
    update public.payment_v2_affiliate_subscription_lifecycles set paid_month_count=month_number,last_paid_invoice_id=p_invoice_id,
      target_commission_percent=case when purchase.referrer_affiliate_tier='og_throne' then (case when month_number>=6 then 25 else 50 end)
        else (case when month_number>=6 then 10 else 20 end) end,updated_at=now()
      where payment_v2_purchase_id=purchase.id returning * into lifecycle;
  end if;
  amount:=round(p_gross_amount_cents*rate/100.0);
  if month_number>1 and initial_ledger.attribution_status='PURCHASER_ATTACHED' and initial_ledger.referred_user_id is not null
     and initial_ledger.status<>'void' then created_commission:=true; end if;
  insert into public.payment_v2_affiliate_recurring_invoices(payment_v2_purchase_id,stripe_subscription_id,stripe_invoice_id,stripe_event_id,
    paid_month_number,gross_amount_cents,currency,commission_percent,commission_amount_cents,commission_created)
  values(purchase.id,p_subscription_id,p_invoice_id,p_provider_event_id,month_number,p_gross_amount_cents,lower(p_currency),
    case when created_commission then rate end,case when created_commission then amount end,created_commission) returning * into invoice;
  if created_commission then
    insert into public.affiliate_ledger(affiliate_user_id,referred_user_id,stripe_event_id,stripe_subscription_id,tier_name,
      commission_amount_cents,gross_amount_cents,commission_percent,status,referral_code_id,referrer_affiliate_tier,attribution_status,payment_v2_recurring_invoice_id,created_at,updated_at)
    values(purchase.referrer_profile_id,initial_ledger.referred_user_id,p_provider_event_id,p_subscription_id,'early_bird',amount,
      p_gross_amount_cents,rate,'pending',purchase.referral_code_id,purchase.referrer_affiliate_tier,'PURCHASER_ATTACHED',invoice.id,now(),now());
  end if;
  return jsonb_build_object('status','recorded','paidMonth',month_number,'commissionPercent',case when created_commission then rate end,
    'nextCommissionPercent',case when initial_ledger.status='void' then 0 else lifecycle.target_commission_percent end,'commissionCreated',created_commission);
end $$;

create or replace function public.create_affiliate_payout_batch(p_notes text default null) returns uuid
language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare batch uuid; inserted_ids uuid[];
begin
 perform pg_advisory_xact_lock(pg_catalog.hashtextextended('affiliate_payout_batch',3200));
 insert into public.affiliate_payout_batches(notes) values(p_notes) returning id into batch;
 with qualifying_affiliates as (
   select l.affiliate_user_id from public.affiliate_ledger l
   where l.status='available' and (l.payment_v2_purchase_id is null or (l.attribution_status='PURCHASER_ATTACHED' and l.referred_user_id is not null))
   group by l.affiliate_user_id having sum(l.commission_amount_cents)>=5000
 ), eligible as (
   select l.* from public.affiliate_ledger l join qualifying_affiliates q using(affiliate_user_id)
   where l.status='available' and (l.payment_v2_purchase_id is null or (l.attribution_status='PURCHASER_ATTACHED' and l.referred_user_id is not null))
   for update of l
 ), ins as (
   insert into public.affiliate_payout_items(batch_id,ledger_id,affiliate_user_id,amount_cents)
   select batch,id,affiliate_user_id,commission_amount_cents from eligible on conflict(ledger_id) do nothing returning ledger_id
 ) select array_agg(ledger_id) into inserted_ids from ins;
 update public.affiliate_ledger set status='paid',updated_at=now() where id=any(coalesce(inserted_ids,array[]::uuid[]));
 return batch;
end $$;

alter function public.payment_v2_record_paid_recurring_invoice(uuid,text,text,text,text,text,timestamptz,integer,text) owner to postgres;
alter function public.create_affiliate_payout_batch(text) owner to postgres;
revoke all on function public.payment_v2_record_paid_recurring_invoice(uuid,text,text,text,text,text,timestamptz,integer,text) from public,anon,authenticated;
grant execute on function public.payment_v2_record_paid_recurring_invoice(uuid,text,text,text,text,text,timestamptz,integer,text) to service_role;
revoke all on function public.create_affiliate_payout_batch(text) from public,anon,authenticated,service_role;
grant select(id,affiliate_user_id,referred_user_id,commission_amount_cents,gross_amount_cents,commission_percent,status,created_at,updated_at,payment_v2_purchase_id,referral_code_id,referrer_affiliate_tier,attribution_status,void_reason,voided_at,payment_v2_recurring_invoice_id) on public.affiliate_ledger to service_role;

do $assert$
begin
 if has_table_privilege('anon','public.affiliate_balances','SELECT') then raise exception 'anon affiliate_balances exposure'; end if;
 if has_table_privilege('authenticated','public.affiliate_balances','SELECT') then raise exception 'authenticated affiliate_balances exposure'; end if;
 if not has_column_privilege('service_role','public.affiliate_ledger','affiliate_user_id','SELECT') then raise exception 'server affiliate summary access missing'; end if;
 if has_table_privilege('service_role','public.affiliate_ledger','INSERT,UPDATE,DELETE') then raise exception 'affiliate_ledger service write exposure'; end if;
end
$assert$;
select pg_notify('pgrst','reload schema');
commit;
