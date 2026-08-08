-- Forward-only affiliate public-cutover hardening (unmerged PFC-CORE-03D).
begin;
do $acl$ begin
 if to_regclass('public.affiliate_balances') is null then raise exception 'PFC_CORE_03D_CATALOG_MISMATCH: missing public.affiliate_balances'; end if;
 execute 'revoke all privileges on table public.affiliate_balances from public, anon, authenticated, service_role';
end $acl$;

alter table public.payment_v2_purchases add column stripe_source_charge_id text, add column stripe_source_payment_intent_id text, add column stripe_initial_invoice_id text;
create unique index payment_v2_purchase_source_charge on public.payment_v2_purchases(stripe_source_charge_id) where stripe_source_charge_id is not null;

create table public.payment_v2_affiliate_recurring_invoices(
 id uuid primary key default gen_random_uuid(), payment_v2_purchase_id uuid not null references public.payment_v2_purchases(id),
 stripe_subscription_id text not null, stripe_invoice_id text not null unique, stripe_event_id text unique,
 stripe_payment_intent_id text not null, stripe_source_charge_id text not null unique, stripe_price_id text not null,
 billing_reason text not null check(billing_reason in('subscription_create','subscription_cycle')),
 service_period_start timestamptz not null, service_period_end timestamptz not null,
 paid_month_number integer not null check(paid_month_number>0), gross_amount_cents integer not null check(gross_amount_cents>=0),
 currency text not null check(currency~'^[a-z]{3}$'), commission_percent numeric, commission_amount_cents integer,
 reconciliation_status text not null default 'RECONCILED' check(reconciliation_status in('RECONCILED','STALE')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(service_period_end>service_period_start), unique(payment_v2_purchase_id,service_period_start,service_period_end)
);
alter table public.affiliate_ledger add column payment_v2_recurring_invoice_id uuid references public.payment_v2_affiliate_recurring_invoices(id);
alter table public.affiliate_ledger drop constraint affiliate_ledger_payment_v2_attribution;
alter table public.affiliate_ledger add constraint affiliate_ledger_payment_v2_attribution check(
 (payment_v2_purchase_id is null and payment_v2_recurring_invoice_id is null and attribution_status is null and referrer_affiliate_tier is null)
 or(payment_v2_purchase_id is not null and payment_v2_recurring_invoice_id is null and referral_code_id is not null and referrer_affiliate_tier in('og_throne','early_bird') and attribution_status in('PURCHASER_UNCLAIMED','PURCHASER_ATTACHED','VOID_SELF_REFERRAL'))
 or(payment_v2_purchase_id is null and payment_v2_recurring_invoice_id is not null and referral_code_id is not null and referrer_affiliate_tier in('og_throne','early_bird') and attribution_status in('PURCHASER_UNCLAIMED','PURCHASER_ATTACHED','VOID_SELF_REFERRAL')));
create unique index affiliate_ledger_one_recurring on public.affiliate_ledger(payment_v2_recurring_invoice_id) where payment_v2_recurring_invoice_id is not null;
alter table public.payment_v2_affiliate_recurring_invoices enable row level security;
revoke all on public.payment_v2_affiliate_recurring_invoices from public,anon,authenticated,service_role;

create function public.payment_v2_record_paid_with_charge(p_hold_id uuid,p_purchaser_hash bytea,p_session_id text,p_customer_id text,p_price_id text,p_payment_intent_id text,p_subscription_id text,p_provider_event_id text,p_provider_confirmed_at timestamptz,p_gross_amount_cents integer,p_currency text,p_source_payment_intent_id text,p_source_charge_id text,p_initial_invoice_id text)
returns text language plpgsql security definer set search_path=pg_catalog,pg_temp as $$ declare result text; begin
 if p_source_payment_intent_id!~'^pi_[A-Za-z0-9]+$' or p_source_charge_id!~'^ch_[A-Za-z0-9]+$' or (p_subscription_id is not null)<>(p_initial_invoice_id is not null) or (p_initial_invoice_id is not null and p_initial_invoice_id!~'^in_[A-Za-z0-9]+$') then raise exception 'invalid_source_charge'; end if;
 result:=public.payment_v2_record_paid(p_hold_id,p_purchaser_hash,p_session_id,p_customer_id,p_price_id,p_payment_intent_id,p_subscription_id,p_provider_event_id,p_provider_confirmed_at,p_gross_amount_cents,p_currency);
 update public.payment_v2_purchases set stripe_source_payment_intent_id=p_source_payment_intent_id,stripe_source_charge_id=p_source_charge_id,stripe_initial_invoice_id=p_initial_invoice_id where hold_id=p_hold_id and (stripe_source_charge_id is null or stripe_source_charge_id=p_source_charge_id) and (stripe_source_payment_intent_id is null or stripe_source_payment_intent_id=p_source_payment_intent_id) and (stripe_initial_invoice_id is null or stripe_initial_invoice_id is not distinct from p_initial_invoice_id);
 if not found then raise exception 'source_charge_conflict'; end if; return result; end $$;

create function public.payment_v2_reconcile_paid_invoices(p_hold_id uuid,p_subscription_id text,p_customer_id text,p_price_id text,p_provider_event_id text,p_invoices jsonb)
returns text language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare purchase public.payment_v2_purchases%rowtype; initial_l public.affiliate_ledger%rowtype; x jsonb; n int:=0; inv_id uuid; rate numeric; amount int; previous_end timestamptz; begin
 if jsonb_typeof(p_invoices)<>'array' or jsonb_array_length(p_invoices)=0 then raise exception 'invalid_invoice_history'; end if;
 perform pg_advisory_xact_lock(pg_catalog.hashtextextended('payment_v2_subscription:'||p_subscription_id,3200));
 select * into purchase from public.payment_v2_purchases p where p.hold_id=p_hold_id and p.stripe_subscription_id=p_subscription_id and p.stripe_customer_id=p_customer_id and p.stripe_price_id=p_price_id and p.tier='early_bird';
 if not found then raise exception 'subscription_purchase_missing'; end if;
 select * into initial_l from public.affiliate_ledger l where l.payment_v2_purchase_id=purchase.id;
 if not found then return 'no_attribution'; end if;
 update public.payment_v2_affiliate_recurring_invoices set reconciliation_status='STALE',updated_at=now() where payment_v2_purchase_id=purchase.id;
 for x in select value from jsonb_array_elements(p_invoices) order by (value->>'periodStart')::timestamptz,(value->>'invoiceId') loop
  n:=n+1;
  if x->>'billingReason' not in('subscription_create','subscription_cycle') or x->>'priceId'<>p_price_id or x->>'subscriptionId'<>p_subscription_id or x->>'customerId'<>p_customer_id
   or (x->>'invoiceId')!~'^in_[A-Za-z0-9]+$' or (x->>'paymentIntentId')!~'^pi_[A-Za-z0-9]+$' or (x->>'sourceChargeId')!~'^ch_[A-Za-z0-9]+$'
   or (x->>'periodEnd')::timestamptz<=(x->>'periodStart')::timestamptz or (previous_end is not null and (x->>'periodStart')::timestamptz<previous_end) or (x->>'grossAmountCents')::int<0 or (x->>'currency')!~'^[a-z]{3}$'
   or (n=1)<>(x->>'billingReason'='subscription_create') then raise exception 'invalid_invoice_history'; end if;
  if n=1 and ((x->>'invoiceId')<>purchase.stripe_initial_invoice_id or (x->>'paymentIntentId')<>purchase.stripe_source_payment_intent_id or (x->>'sourceChargeId')<>purchase.stripe_source_charge_id) then raise exception 'initial_invoice_conflict'; end if; previous_end:=(x->>'periodEnd')::timestamptz;
  if exists(select 1 from public.payment_v2_affiliate_recurring_invoices i where i.stripe_invoice_id=x->>'invoiceId' and (i.payment_v2_purchase_id<>purchase.id or i.stripe_payment_intent_id<>x->>'paymentIntentId' or i.stripe_source_charge_id<>x->>'sourceChargeId' or i.stripe_price_id<>p_price_id or i.billing_reason<>x->>'billingReason' or i.service_period_start<>(x->>'periodStart')::timestamptz or i.service_period_end<>(x->>'periodEnd')::timestamptz or i.gross_amount_cents<>(x->>'grossAmountCents')::int or i.currency<>x->>'currency')) then raise exception 'invoice_evidence_conflict'; end if;
  if exists(select 1 from public.payment_v2_affiliate_recurring_invoices ri join public.affiliate_ledger al on al.payment_v2_recurring_invoice_id=ri.id left join public.affiliate_payout_items ai on ai.ledger_id=al.id and ai.execution_status='succeeded' where ri.stripe_invoice_id=x->>'invoiceId' and (al.status='paid' or ai.id is not null) and (ri.paid_month_number<>n or ri.commission_percent is distinct from (case when purchase.referrer_affiliate_tier='og_throne' then case when n<=6 then 50 else 25 end else case when n<=6 then 20 else 10 end end) or ri.commission_amount_cents is distinct from round((x->>'grossAmountCents')::int*(case when purchase.referrer_affiliate_tier='og_throne' then case when n<=6 then 50 else 25 end else case when n<=6 then 20 else 10 end end)/100.0))) then raise exception 'paid_reconciliation_conflict'; end if;
  rate:=case when purchase.referrer_affiliate_tier='og_throne' then case when n<=6 then 50 else 25 end else case when n<=6 then 20 else 10 end end;
  amount:=round((x->>'grossAmountCents')::int*rate/100.0);
  insert into public.payment_v2_affiliate_recurring_invoices(payment_v2_purchase_id,stripe_subscription_id,stripe_invoice_id,stripe_event_id,stripe_payment_intent_id,stripe_source_charge_id,stripe_price_id,billing_reason,service_period_start,service_period_end,paid_month_number,gross_amount_cents,currency,commission_percent,commission_amount_cents)
  values(purchase.id,p_subscription_id,x->>'invoiceId',x->>'providerEventId',x->>'paymentIntentId',x->>'sourceChargeId',p_price_id,x->>'billingReason',(x->>'periodStart')::timestamptz,(x->>'periodEnd')::timestamptz,n,(x->>'grossAmountCents')::int,x->>'currency',case when n>1 then rate end,case when n>1 then amount end)
  on conflict(stripe_invoice_id) do update set stripe_event_id=coalesce(payment_v2_affiliate_recurring_invoices.stripe_event_id,excluded.stripe_event_id),paid_month_number=excluded.paid_month_number,commission_percent=excluded.commission_percent,commission_amount_cents=excluded.commission_amount_cents,reconciliation_status='RECONCILED',updated_at=now()
  returning id into inv_id;
  if n>1 then
   insert into public.affiliate_ledger(affiliate_user_id,referred_user_id,stripe_event_id,stripe_subscription_id,tier_name,commission_amount_cents,gross_amount_cents,commission_percent,status,referral_code_id,referrer_affiliate_tier,attribution_status,payment_v2_recurring_invoice_id,void_reason,voided_at,created_at,updated_at)
   values(purchase.referrer_profile_id,initial_l.referred_user_id,'invoice:'||(x->>'invoiceId'),p_subscription_id,'early_bird',amount,(x->>'grossAmountCents')::int,rate,case when initial_l.attribution_status='VOID_SELF_REFERRAL' then 'void' else 'pending' end,purchase.referral_code_id,purchase.referrer_affiliate_tier,initial_l.attribution_status,inv_id,case when initial_l.attribution_status='VOID_SELF_REFERRAL' then 'SELF_REFERRAL' end,case when initial_l.attribution_status='VOID_SELF_REFERRAL' then now() end,now(),now())
   on conflict(payment_v2_recurring_invoice_id) where payment_v2_recurring_invoice_id is not null do update set commission_amount_cents=excluded.commission_amount_cents,commission_percent=excluded.commission_percent,attribution_status=excluded.attribution_status,referred_user_id=excluded.referred_user_id,updated_at=now();
  end if;
 end loop; return 'reconciled'; end $$;

create function public.payment_v2_sync_recurring_attribution() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$ begin
 if new.payment_v2_purchase_id is not null and new.attribution_status is distinct from old.attribution_status then
  update public.affiliate_ledger l set referred_user_id=new.referred_user_id,attribution_status=new.attribution_status,status=case when new.attribution_status='VOID_SELF_REFERRAL' then 'void' else l.status end,void_reason=case when new.attribution_status='VOID_SELF_REFERRAL' then 'SELF_REFERRAL' end,voided_at=case when new.attribution_status='VOID_SELF_REFERRAL' then now() end,updated_at=now()
  from public.payment_v2_affiliate_recurring_invoices i where l.payment_v2_recurring_invoice_id=i.id and i.payment_v2_purchase_id=new.payment_v2_purchase_id and l.status<>'paid';
 end if; return new; end $$;
create trigger payment_v2_sync_recurring_attribution after update of attribution_status on public.affiliate_ledger for each row execute function public.payment_v2_sync_recurring_attribution();

alter table public.affiliate_payout_items add column currency text,add column source_charge_id text,add column connect_destination text,add column transfer_id text,add column transfer_idempotency_key text,add column execution_status text not null default 'pending',add column attempt_count integer not null default 0,add column last_error_code text,add column updated_at timestamptz not null default now();
create unique index affiliate_payout_transfer_idempotency on public.affiliate_payout_items(transfer_idempotency_key) where transfer_idempotency_key is not null;
create or replace function public.release_affiliate_commissions() returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$ begin
 update public.affiliate_ledger l set status='available',updated_at=now() where l.status='pending' and l.created_at<=now()-interval '7 days' and ((l.payment_v2_purchase_id is null and l.payment_v2_recurring_invoice_id is null) or (l.payment_v2_purchase_id is not null and l.attribution_status='PURCHASER_ATTACHED' and l.referred_user_id is not null) or (l.payment_v2_recurring_invoice_id is not null and l.attribution_status='PURCHASER_ATTACHED' and l.referred_user_id is not null and exists(select 1 from public.payment_v2_affiliate_recurring_invoices i where i.id=l.payment_v2_recurring_invoice_id and i.reconciliation_status='RECONCILED'))); end $$;
create or replace function public.create_affiliate_payout_batch(p_notes text default null) returns uuid language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$ declare batch uuid; begin
 perform pg_advisory_xact_lock(pg_catalog.hashtextextended('affiliate_payout_batch',3200));insert into public.affiliate_payout_batches(notes)values(p_notes)returning id into batch;
 with eligible as(select l.*,case when l.payment_v2_recurring_invoice_id is not null then i.currency else p.currency end cur,case when l.payment_v2_recurring_invoice_id is not null then i.stripe_source_charge_id else p.stripe_source_charge_id end charge,coalesce(h.stripe_connect_destination,pr.stripe_connect_account_id) destination from public.affiliate_ledger l left join public.payment_v2_affiliate_recurring_invoices i on i.id=l.payment_v2_recurring_invoice_id left join public.payment_v2_purchases p on p.id=coalesce(l.payment_v2_purchase_id,i.payment_v2_purchase_id) left join public.payment_v2_holds h on h.id=p.hold_id left join public.profiles pr on pr.id=l.affiliate_user_id where l.status='available' and ((l.payment_v2_purchase_id is null and l.payment_v2_recurring_invoice_id is null) or(l.attribution_status='PURCHASER_ATTACHED' and l.referred_user_id is not null and(l.payment_v2_recurring_invoice_id is null or i.reconciliation_status='RECONCILED')))),qualified as(select affiliate_user_id from eligible group by affiliate_user_id having sum(commission_amount_cents)>=5000),ins as(insert into public.affiliate_payout_items(batch_id,ledger_id,affiliate_user_id,amount_cents,currency,source_charge_id,connect_destination,transfer_idempotency_key,execution_status)select batch,e.id,e.affiliate_user_id,e.commission_amount_cents,e.cur,e.charge,e.destination,'pfc03d:'||e.id,case when e.payment_v2_purchase_id is null and e.payment_v2_recurring_invoice_id is null then 'legacy' else 'pending' end from eligible e join qualified q using(affiliate_user_id) where(e.payment_v2_purchase_id is null and e.payment_v2_recurring_invoice_id is null)or(e.charge is not null and e.destination~'^acct_[A-Za-z0-9]+$')on conflict(ledger_id)do nothing returning ledger_id,execution_status)update public.affiliate_ledger set status='paid',updated_at=now()where id in(select ledger_id from ins where execution_status='legacy');return batch;end $$;
create function public.prepare_affiliate_payout_batch(p_notes text default null)returns uuid language plpgsql security definer set search_path=pg_catalog,pg_temp as $$begin return public.create_affiliate_payout_batch(p_notes);end$$;


create function public.payment_v2_get_payout_recurring_context(p_item_id uuid)returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$select jsonb_build_object('invoiceId',r.stripe_invoice_id,'subscriptionId',r.stripe_subscription_id,'holdId',p.hold_id,'customerId',p.stripe_customer_id,'priceId',r.stripe_price_id) from public.affiliate_payout_items x join public.affiliate_ledger l on l.id=x.ledger_id join public.payment_v2_affiliate_recurring_invoices r on r.id=l.payment_v2_recurring_invoice_id join public.payment_v2_purchases p on p.id=r.payment_v2_purchase_id where x.id=p_item_id and x.execution_status='pending'$$;
create function public.payment_v2_verify_payout_recurring_item(p_item_id uuid)returns boolean language sql security definer set search_path=pg_catalog,pg_temp as $$select exists(select 1 from public.affiliate_payout_items x join public.affiliate_ledger l on l.id=x.ledger_id join public.payment_v2_affiliate_recurring_invoices r on r.id=l.payment_v2_recurring_invoice_id where x.id=p_item_id and x.execution_status='pending' and r.reconciliation_status='RECONCILED' and l.status='available' and l.attribution_status='PURCHASER_ATTACHED' and l.referred_user_id is not null and l.commission_amount_cents=x.amount_cents and r.commission_amount_cents=x.amount_cents and r.stripe_source_charge_id=x.source_charge_id and r.currency=x.currency)$$;
create function public.complete_affiliate_payout_item(p_item_id uuid,p_transfer_id text) returns boolean language plpgsql security definer set search_path=pg_catalog,pg_temp as $$ declare lid uuid; begin
 if p_transfer_id!~'^tr_[A-Za-z0-9]+$' then raise exception 'invalid_transfer'; end if;
 update public.affiliate_payout_items set transfer_id=p_transfer_id,execution_status='succeeded',updated_at=now() where id=p_item_id and execution_status='pending' and transfer_id is null returning ledger_id into lid;
 if lid is null then return exists(select 1 from public.affiliate_payout_items where id=p_item_id and transfer_id=p_transfer_id and execution_status='succeeded'); end if;
 update public.affiliate_ledger set status='paid',updated_at=now() where id=lid and status='available'; if not found then raise exception 'ledger_not_available'; end if; return true; end $$;
create function public.fail_affiliate_payout_item(p_item_id uuid,p_error_code text) returns boolean language plpgsql security definer set search_path=pg_catalog,pg_temp as $$ begin
 if p_error_code is null or length(p_error_code)>100 then raise exception 'invalid_error_code'; end if;
 update public.affiliate_payout_items set attempt_count=attempt_count+1,last_error_code=p_error_code,updated_at=now() where id=p_item_id and execution_status='pending' and transfer_id is null; return found; end $$;

alter function public.payment_v2_record_paid_with_charge(uuid,bytea,text,text,text,text,text,text,timestamptz,integer,text,text,text,text) owner to postgres;
alter function public.payment_v2_get_payout_recurring_context(uuid) owner to postgres;alter function public.payment_v2_verify_payout_recurring_item(uuid) owner to postgres;
alter function public.release_affiliate_commissions() owner to postgres;alter function public.prepare_affiliate_payout_batch(text) owner to postgres;
alter function public.payment_v2_reconcile_paid_invoices(uuid,text,text,text,text,jsonb) owner to postgres;alter function public.complete_affiliate_payout_item(uuid,text) owner to postgres;alter function public.fail_affiliate_payout_item(uuid,text) owner to postgres;
alter function public.payment_v2_sync_recurring_attribution() owner to postgres;revoke all on function public.payment_v2_sync_recurring_attribution() from public,anon,authenticated,service_role;
revoke all on function public.payment_v2_record_paid_with_charge(uuid,bytea,text,text,text,text,text,text,timestamptz,integer,text,text,text,text),public.payment_v2_reconcile_paid_invoices(uuid,text,text,text,text,jsonb),public.complete_affiliate_payout_item(uuid,text),public.fail_affiliate_payout_item(uuid,text) from public,anon,authenticated;
revoke all on function public.payment_v2_get_payout_recurring_context(uuid),public.payment_v2_verify_payout_recurring_item(uuid) from public,anon,authenticated;grant execute on function public.payment_v2_get_payout_recurring_context(uuid),public.payment_v2_verify_payout_recurring_item(uuid) to service_role;
revoke all on function public.prepare_affiliate_payout_batch(text) from public,anon,authenticated;grant execute on function public.prepare_affiliate_payout_batch(text) to service_role;
grant execute on function public.payment_v2_record_paid_with_charge(uuid,bytea,text,text,text,text,text,text,timestamptz,integer,text,text,text,text),public.payment_v2_reconcile_paid_invoices(uuid,text,text,text,text,jsonb),public.complete_affiliate_payout_item(uuid,text),public.fail_affiliate_payout_item(uuid,text) to service_role;
grant select(payment_v2_recurring_invoice_id) on public.affiliate_ledger to service_role;
revoke all on function public.create_affiliate_payout_batch(text) from public,anon,authenticated,service_role;
do $assert$ begin if has_table_privilege('anon','public.affiliate_balances','SELECT') or has_table_privilege('authenticated','public.affiliate_balances','SELECT') then raise exception 'affiliate_balances exposure'; end if; end $assert$;
select pg_notify('pgrst','reload schema');commit;
