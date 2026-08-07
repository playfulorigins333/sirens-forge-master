-- Forward-only Payment V2 affiliate attribution and obligation contract.
begin;

alter table public.payment_v2_holds
  add column referral_code_id bigint references public.referral_codes(id),
  add column referrer_auth_user_id uuid,
  add column referrer_profile_id uuid references public.profiles(id),
  add column referrer_affiliate_tier text,
  add column referral_bound_at timestamptz,
  add column stripe_connect_destination text;
alter table public.payment_v2_holds add constraint payment_v2_hold_referral_tuple check (
  (referral_code_id is null and referrer_auth_user_id is null and referrer_profile_id is null and referrer_affiliate_tier is null and referral_bound_at is null and stripe_connect_destination is null)
  or (referral_code_id is not null and referrer_auth_user_id is not null and referrer_profile_id is not null and referrer_affiliate_tier in ('og_throne','early_bird') and referral_bound_at is not null)
);

alter table public.payment_v2_purchases
  add column referral_code_id bigint references public.referral_codes(id),
  add column referrer_auth_user_id uuid,
  add column referrer_profile_id uuid references public.profiles(id),
  add column referrer_affiliate_tier text,
  add column referral_bound_at timestamptz,
  add column gross_amount_cents integer,
  add column currency text;
alter table public.payment_v2_purchases add constraint payment_v2_purchase_referral_tuple check (
  (referral_code_id is null and referrer_auth_user_id is null and referrer_profile_id is null and referrer_affiliate_tier is null and referral_bound_at is null)
  or (referral_code_id is not null and referrer_auth_user_id is not null and referrer_profile_id is not null and referrer_affiliate_tier in ('og_throne','early_bird') and referral_bound_at is not null)
);
alter table public.payment_v2_purchases add constraint payment_v2_verified_money check (gross_amount_cents >= 0 and currency ~ '^[a-z]{3}$');

alter table public.affiliate_ledger
  add column if not exists referred_user_id uuid,
  add column if not exists gross_amount_cents integer,
  add column if not exists commission_percent numeric,
  add column payment_v2_purchase_id uuid references public.payment_v2_purchases(id),
  add column referral_code_id bigint references public.referral_codes(id),
  add column referrer_affiliate_tier text,
  add column attribution_status text,
  add column void_reason text,
  add column voided_at timestamptz;
alter table public.affiliate_ledger alter column referred_user_id drop not null;
create unique index affiliate_ledger_one_payment_v2_obligation on public.affiliate_ledger(payment_v2_purchase_id) where payment_v2_purchase_id is not null;
alter table public.affiliate_ledger add constraint affiliate_ledger_payment_v2_attribution check (
  (payment_v2_purchase_id is null and attribution_status is null and referrer_affiliate_tier is null)
  or (payment_v2_purchase_id is not null and referral_code_id is not null and referrer_affiliate_tier in ('og_throne','early_bird') and attribution_status in ('PURCHASER_UNCLAIMED','PURCHASER_ATTACHED','VOID_SELF_REFERRAL'))
);
alter table public.affiliate_ledger add constraint affiliate_ledger_payment_v2_void check (
  (attribution_status='VOID_SELF_REFERRAL' and status='void' and void_reason='SELF_REFERRAL' and voided_at is not null and referred_user_id is not null)
  or (attribution_status is distinct from 'VOID_SELF_REFERRAL' and void_reason is null and voided_at is null)
);

alter table public.payment_v2_reconciliation_evidence drop constraint payment_v2_reconciliation_evidence_event_kind_check;
alter table public.payment_v2_reconciliation_evidence drop constraint payment_v2_reconciliation_evidence_check;
alter table public.payment_v2_reconciliation_evidence drop constraint payment_v2_reconciliation_evidence_check1;
alter table public.payment_v2_reconciliation_evidence drop constraint payment_v2_reconciliation_evidence_check2;
alter table public.payment_v2_reconciliation_evidence add constraint payment_v2_evidence_kind check (event_kind in ('PAYMENT_CONFIRMED','SESSION_EXPIRED_UNPAID','PAYMENT_CANCELED_UNPAID','CLAIMED','AFFILIATE_OBLIGATION_CREATED','AFFILIATE_PURCHASER_ATTACHED','AFFILIATE_SELF_REFERRAL_VOIDED'));
alter table public.payment_v2_reconciliation_evidence add constraint payment_v2_evidence_provider check (
  (event_kind in ('PAYMENT_CONFIRMED','SESSION_EXPIRED_UNPAID','PAYMENT_CANCELED_UNPAID') and provider_event_id is not null)
  or (event_kind in ('CLAIMED','AFFILIATE_OBLIGATION_CREATED','AFFILIATE_PURCHASER_ATTACHED','AFFILIATE_SELF_REFERRAL_VOIDED') and provider_event_id is null)
);
alter table public.payment_v2_reconciliation_evidence add constraint payment_v2_evidence_purchase check ((event_kind in ('PAYMENT_CONFIRMED','CLAIMED','AFFILIATE_OBLIGATION_CREATED','AFFILIATE_PURCHASER_ATTACHED','AFFILIATE_SELF_REFERRAL_VOIDED')) = (purchase_id is not null));
alter table public.payment_v2_reconciliation_evidence add constraint payment_v2_evidence_session check ((event_kind in ('CLAIMED','AFFILIATE_OBLIGATION_CREATED','AFFILIATE_PURCHASER_ATTACHED','AFFILIATE_SELF_REFERRAL_VOIDED') and stripe_checkout_session_id is null) or (event_kind in ('PAYMENT_CONFIRMED','SESSION_EXPIRED_UNPAID','PAYMENT_CANCELED_UNPAID') and btrim(coalesce(stripe_checkout_session_id,''))<>''));

-- The old overload cannot validate or bind a referral.
revoke all on function public.payment_v2_acquire_hold(bytea,text,timestamptz) from public,anon,authenticated,service_role;
drop function public.payment_v2_acquire_hold(bytea,text,timestamptz);
create function public.payment_v2_acquire_hold(p_purchaser_hash bytea,p_tier text,p_expires_at timestamptz,p_referral_code text default null)
returns table(hold_id uuid,state text,expires_at timestamptz,connect_destination text,commission_percent numeric)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare h public.payment_v2_holds%rowtype; lim integer; normalized text; rc public.referral_codes%rowtype; auth_id uuid; profile public.profiles%rowtype; profile_count bigint; entitlement_count bigint; affiliate_tier text; rate numeric; destination text;
begin
 if octet_length(p_purchaser_hash)<>32 or p_tier not in ('og_throne','early_bird') or p_expires_at<=now() or p_expires_at>now()+interval '2 hours' then raise exception 'invalid_request'; end if;
 normalized:=case when p_referral_code is null then null else upper(p_referral_code) end;
 if normalized is not null then
  if normalized !~ '^[A-Z0-9_-]{4,20}$' then raise exception 'invalid_referral'; end if;
  select * into rc from public.referral_codes r where upper(r.code)=normalized;
  if not found or rc.is_active is not true or (rc.expires_at is not null and rc.expires_at<=now()) then raise exception 'invalid_referral'; end if;
  auth_id:=rc.user_id;
  select count(*) into profile_count from public.profiles p where p.user_id=auth_id;
  if profile_count<>1 then raise exception 'invalid_referral_profile'; end if;
  select * into profile from public.profiles p where p.user_id=auth_id;
  select count(*) into entitlement_count from public.user_subscriptions s where s.user_id=profile.id and s.status in ('active','trialing') and s.tier_name in ('og_throne','early_bird');
  if entitlement_count<>1 then raise exception 'invalid_referral_entitlement'; end if;
  select s.tier_name into affiliate_tier from public.user_subscriptions s where s.user_id=profile.id and s.status in ('active','trialing') and s.tier_name in ('og_throne','early_bird');
  if profile.stripe_connect_onboarded and (profile.stripe_connect_account_id is null or profile.stripe_connect_account_id !~ '^acct_[A-Za-z0-9]+$') then raise exception 'invalid_referral_connect'; end if;
  destination:=case when profile.stripe_connect_onboarded then profile.stripe_connect_account_id else null end;
  rate:=case when p_tier='og_throne' and affiliate_tier='og_throne' then 25 when p_tier='og_throne' then 10 when affiliate_tier='og_throne' then 50 else 20 end;
 end if;
 perform pg_advisory_xact_lock(pg_catalog.hashtextextended('payment_v2_credential:'||encode(p_purchaser_hash,'hex'),3100));
 perform pg_advisory_xact_lock(pg_catalog.hashtextextended('payment_v2_capacity:early_bird',3100)); perform pg_advisory_xact_lock(pg_catalog.hashtextextended('payment_v2_capacity:og_throne',3100));
 update public.payment_v2_holds x set state='EXPIRED_UNPAID',updated_at=now() where x.purchaser_credential_hash=p_purchaser_hash and x.state='HELD' and x.stripe_checkout_session_id is null and x.expires_at<=now();
 select * into h from public.payment_v2_holds x where x.purchaser_credential_hash=p_purchaser_hash and ((x.state='HELD' and x.expires_at>now()) or x.state in ('SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED')) for update;
 if found then
  if h.tier<>p_tier then raise exception 'effective_hold_conflict'; end if;
  if h.referral_code_id is distinct from rc.id or h.referrer_auth_user_id is distinct from auth_id or h.referrer_profile_id is distinct from profile.id or h.referrer_affiliate_tier is distinct from affiliate_tier then raise exception 'attribution_conflict'; end if;
  return query select h.id,h.state,h.expires_at,h.stripe_connect_destination,rate; return;
 end if;
 update public.payment_v2_holds x set state='EXPIRED_UNPAID',updated_at=now() where x.tier=p_tier and x.state='HELD' and x.stripe_checkout_session_id is null and x.expires_at<=now();
 lim:=case p_tier when 'og_throne' then 50 else 120 end;
 if (select count(*) from public.payment_v2_holds x where x.tier=p_tier and ((x.state='HELD' and x.expires_at>now()) or x.state in ('SESSION_ASSOCIATED','PAID_UNCLAIMED','CLAIMED')))>=lim then raise exception 'sold_out'; end if;
 insert into public.payment_v2_holds(purchaser_credential_hash,tier,expires_at,referral_code_id,referrer_auth_user_id,referrer_profile_id,referrer_affiliate_tier,referral_bound_at,stripe_connect_destination)
 values(p_purchaser_hash,p_tier,p_expires_at,rc.id,auth_id,profile.id,affiliate_tier,case when rc.id is null then null else now() end,destination) returning * into h;
 return query select h.id,h.state,h.expires_at,h.stripe_connect_destination,rate;
end $$;

revoke all on function public.payment_v2_record_paid(uuid,bytea,text,text,text,text,text,text,timestamptz) from public,anon,authenticated,service_role;
drop function public.payment_v2_record_paid(uuid,bytea,text,text,text,text,text,text,timestamptz);
create function public.payment_v2_record_paid(p_hold_id uuid,p_purchaser_hash bytea,p_session_id text,p_customer_id text,p_price_id text,p_payment_intent_id text,p_subscription_id text,p_provider_event_id text,p_provider_confirmed_at timestamptz,p_gross_amount_cents integer,p_currency text)
returns text language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare h public.payment_v2_holds%rowtype; p public.payment_v2_purchases%rowtype; tier_count bigint; expected_price text; rate numeric; commission integer;
begin
 if octet_length(p_purchaser_hash)<>32 or btrim(coalesce(p_session_id,''))='' or btrim(coalesce(p_customer_id,''))='' or btrim(coalesce(p_price_id,''))='' or btrim(coalesce(p_provider_event_id,''))='' or p_provider_confirmed_at is null or p_gross_amount_cents<0 or lower(coalesce(p_currency,''))!~'^[a-z]{3}$' then raise exception 'invalid_request'; end if;
 select * into h from public.payment_v2_holds where id=p_hold_id for update;
 if not found or h.purchaser_credential_hash<>p_purchaser_hash or h.stripe_checkout_session_id<>p_session_id then raise exception 'hold_mismatch'; end if;
 if not ((h.tier='og_throne' and btrim(coalesce(p_payment_intent_id,''))<>'' and p_subscription_id is null) or (h.tier='early_bird' and p_payment_intent_id is null and btrim(coalesce(p_subscription_id,''))<>'')) then raise exception 'provider_identity_mismatch'; end if;
 select * into p from public.payment_v2_purchases where hold_id=p_hold_id for update;
 if found then
  if p.purchaser_credential_hash=p_purchaser_hash and p.stripe_checkout_session_id=p_session_id and p.stripe_customer_id=p_customer_id and p.stripe_price_id=p_price_id and p.stripe_payment_intent_id is not distinct from p_payment_intent_id and p.stripe_subscription_id is not distinct from p_subscription_id and p.gross_amount_cents=p_gross_amount_cents and p.currency=lower(p_currency) then return 'already_recorded'; end if;
  raise exception 'purchase_conflict';
 end if;
 select count(*),min(stripe_price_id) into tier_count,expected_price from public.subscription_tiers where name=h.tier and is_active=true;
 if tier_count<>1 or expected_price is distinct from p_price_id then raise exception 'price_mismatch'; end if;
 if h.state<>'SESSION_ASSOCIATED' then raise exception 'invalid_state'; end if;
 insert into public.payment_v2_purchases(hold_id,purchaser_credential_hash,tier,stripe_checkout_session_id,stripe_customer_id,stripe_price_id,stripe_payment_intent_id,stripe_subscription_id,provider_event_id,provider_confirmed_at,referral_code_id,referrer_auth_user_id,referrer_profile_id,referrer_affiliate_tier,referral_bound_at,gross_amount_cents,currency)
 values(h.id,p_purchaser_hash,h.tier,p_session_id,p_customer_id,p_price_id,p_payment_intent_id,p_subscription_id,p_provider_event_id,p_provider_confirmed_at,h.referral_code_id,h.referrer_auth_user_id,h.referrer_profile_id,h.referrer_affiliate_tier,h.referral_bound_at,p_gross_amount_cents,lower(p_currency)) returning * into p;
 if h.referral_code_id is not null then
  rate:=case when h.tier='og_throne' and h.referrer_affiliate_tier='og_throne' then 25 when h.tier='og_throne' then 10 when h.referrer_affiliate_tier='og_throne' then 50 else 20 end; commission:=round(p_gross_amount_cents*rate/100.0);
  insert into public.affiliate_ledger(affiliate_user_id,referred_user_id,commission_amount_cents,gross_amount_cents,commission_percent,status,payment_v2_purchase_id,referral_code_id,referrer_affiliate_tier,attribution_status,created_at,updated_at)
  values(h.referrer_profile_id,null,commission,p_gross_amount_cents,rate,'pending',p.id,h.referral_code_id,h.referrer_affiliate_tier,'PURCHASER_UNCLAIMED',now(),now());
  insert into public.payment_v2_reconciliation_evidence(hold_id,purchase_id,event_kind,occurred_at) values(h.id,p.id,'AFFILIATE_OBLIGATION_CREATED',now());
 end if;
 update public.payment_v2_holds set state='PAID_UNCLAIMED',updated_at=now() where id=h.id;
 insert into public.payment_v2_reconciliation_evidence(hold_id,purchase_id,stripe_checkout_session_id,event_kind,provider_event_id,occurred_at) values(h.id,p.id,p_session_id,'PAYMENT_CONFIRMED',p_provider_event_id,p_provider_confirmed_at);
 return 'recorded';
end $$;

create or replace function public.payment_v2_claim(p_purchase_id uuid,p_purchaser_hash bytea,p_profile_id uuid,p_auth_user_id uuid)
returns text language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p public.payment_v2_purchases%rowtype; pr public.profiles%rowtype; t public.subscription_tiers%rowtype; entitlement uuid; existing public.user_subscriptions%rowtype; n bigint; ledger public.affiliate_ledger%rowtype; affiliate_event text;
begin
 if octet_length(p_purchaser_hash)<>32 or p_profile_id is null or p_auth_user_id is null then raise exception 'invalid_request'; end if;
 select * into p from public.payment_v2_purchases where id=p_purchase_id for update;
 if not found or p.purchaser_credential_hash<>p_purchaser_hash then raise exception 'purchase_mismatch'; end if;
 if p.state='CLAIMED' then
  if p.claimed_profile_id<>p_profile_id or not exists(select 1 from public.payment_v2_allocations where purchase_id=p.id and profile_id=p_profile_id) then raise exception 'claimed_by_other_profile'; end if;
  if p.referral_code_id is not null and not exists(select 1 from public.affiliate_ledger where payment_v2_purchase_id=p.id and referred_user_id=p_auth_user_id and attribution_status in ('PURCHASER_ATTACHED','VOID_SELF_REFERRAL')) then raise exception 'affiliate_claim_mismatch'; end if;
  return 'already_claimed';
 end if;
 if p.state<>'PAID_UNCLAIMED' then raise exception 'not_claimable'; end if;
 select * into pr from public.profiles where id=p_profile_id for update;
 if not found or pr.user_id<>p_auth_user_id then raise exception 'authenticated_profile_mismatch'; end if;
 if exists(select 1 from public.payment_v2_allocations where profile_id=p_profile_id and tier=p.tier) then raise exception 'duplicate_entitlement'; end if;
 select count(*) into n from public.subscription_tiers x where x.name=p.tier and x.stripe_price_id=p.stripe_price_id; if n<>1 then raise exception 'claim_tier_ambiguous_or_missing'; end if;
 select * into t from public.subscription_tiers x where x.name=p.tier and x.stripe_price_id=p.stripe_price_id;
 select count(*) into n from public.user_subscriptions s where s.user_id=p_profile_id and s.tier_name=p.tier and s.status in ('active','trialing'); if n>1 then raise exception 'ambiguous_existing_entitlement'; end if;
 if n=1 then
  select * into existing from public.user_subscriptions s where s.user_id=p_profile_id and s.tier_name=p.tier and s.status in ('active','trialing') for update;
  if existing.tier_id is distinct from t.id or existing.stripe_customer_id is distinct from p.stripe_customer_id or existing.stripe_subscription_id is distinct from p.stripe_subscription_id or (p.tier='og_throne' and existing.metadata->>'payment_intent_id' is distinct from p.stripe_payment_intent_id) then raise exception 'conflicting_existing_entitlement'; end if; entitlement:=existing.id;
 else
  insert into public.user_subscriptions(user_id,tier_id,tier_name,stripe_customer_id,stripe_subscription_id,status,metadata) values(p_profile_id,t.id,p.tier,p.stripe_customer_id,p.stripe_subscription_id,'active',jsonb_build_object('checkout_contract','sirens_forge_payment_v2','purchase_id',p.id,'payment_intent_id',p.stripe_payment_intent_id,'customer_facing_allocation',true)) returning id into entitlement;
 end if;
 if p.referral_code_id is not null then
  select * into ledger from public.affiliate_ledger where payment_v2_purchase_id=p.id for update; if not found or ledger.attribution_status<>'PURCHASER_UNCLAIMED' or ledger.referred_user_id is not null then raise exception 'affiliate_obligation_mismatch'; end if;
  if p_auth_user_id=p.referrer_auth_user_id then
   update public.affiliate_ledger set referred_user_id=p_auth_user_id,attribution_status='VOID_SELF_REFERRAL',status='void',void_reason='SELF_REFERRAL',voided_at=now(),updated_at=now() where id=ledger.id; affiliate_event:='AFFILIATE_SELF_REFERRAL_VOIDED';
  else
   update public.affiliate_ledger set referred_user_id=p_auth_user_id,attribution_status='PURCHASER_ATTACHED',updated_at=now() where id=ledger.id; affiliate_event:='AFFILIATE_PURCHASER_ATTACHED';
  end if;
 end if;
 insert into public.payment_v2_allocations(purchase_id,tier,profile_id,entitlement_id) values(p.id,p.tier,p_profile_id,entitlement);
 update public.payment_v2_purchases set state='CLAIMED',claimed_profile_id=p_profile_id,claimed_at=now(),updated_at=now() where id=p.id;
 update public.payment_v2_holds set state='CLAIMED',updated_at=now() where id=p.hold_id;
 insert into public.payment_v2_reconciliation_evidence(hold_id,purchase_id,event_kind,occurred_at) values(p.hold_id,p.id,'CLAIMED',now());
 if affiliate_event is not null then insert into public.payment_v2_reconciliation_evidence(hold_id,purchase_id,event_kind,occurred_at) values(p.hold_id,p.id,affiliate_event,now()); end if;
 return 'claimed';
end $$;

create or replace function public.release_affiliate_commissions() returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 update public.affiliate_ledger set status='available',updated_at=now()
 where status='pending' and created_at<=now()-interval '7 days'
 and (payment_v2_purchase_id is null or (attribution_status='PURCHASER_ATTACHED' and referred_user_id is not null));
end $$;

create or replace function public.create_affiliate_payout_batch(p_notes text default null) returns uuid language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare batch uuid; inserted_ids uuid[];
begin
 insert into public.affiliate_payout_batches(notes) values(p_notes) returning id into batch;
 with eligible as (
   select l.* from public.affiliate_ledger l where l.status='available' and (l.payment_v2_purchase_id is null or (l.attribution_status='PURCHASER_ATTACHED' and l.referred_user_id is not null)) for update skip locked
 ), ins as (
   insert into public.affiliate_payout_items(batch_id,ledger_id,affiliate_user_id,amount_cents)
   select batch,id,affiliate_user_id,commission_amount_cents from eligible on conflict(ledger_id) do nothing returning ledger_id
 ) select array_agg(ledger_id) into inserted_ids from ins;
 update public.affiliate_ledger set status='paid',updated_at=now() where id=any(coalesce(inserted_ids,array[]::uuid[]));
 return batch;
end $$;

alter function public.payment_v2_acquire_hold(bytea,text,timestamptz,text) owner to postgres;
alter function public.payment_v2_record_paid(uuid,bytea,text,text,text,text,text,text,timestamptz,integer,text) owner to postgres;
alter function public.payment_v2_claim(uuid,bytea,uuid,uuid) owner to postgres;
alter function public.release_affiliate_commissions() owner to postgres;
alter function public.create_affiliate_payout_batch(text) owner to postgres;
revoke all on function public.payment_v2_acquire_hold(bytea,text,timestamptz,text),public.payment_v2_record_paid(uuid,bytea,text,text,text,text,text,text,timestamptz,integer,text),public.payment_v2_claim(uuid,bytea,uuid,uuid) from public,anon,authenticated;
grant execute on function public.payment_v2_acquire_hold(bytea,text,timestamptz,text),public.payment_v2_record_paid(uuid,bytea,text,text,text,text,text,text,timestamptz,integer,text),public.payment_v2_claim(uuid,bytea,uuid,uuid) to service_role;
revoke all on function public.create_affiliate_payout_batch(text) from public,anon,authenticated,service_role;
revoke all privileges on public.affiliate_ledger from service_role;
grant select(id,affiliate_user_id,referred_user_id,commission_amount_cents,gross_amount_cents,commission_percent,status,created_at,updated_at,payment_v2_purchase_id,referral_code_id,referrer_affiliate_tier,attribution_status,void_reason,voided_at) on public.affiliate_ledger to service_role;
select pg_notify('pgrst','reload schema');
commit;
