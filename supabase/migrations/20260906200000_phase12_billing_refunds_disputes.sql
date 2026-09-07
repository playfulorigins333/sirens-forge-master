-- Phase 12: read-only provider lifecycle consumption and fail-closed financial safety.
-- Production application requires separate explicit authorization.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.payment_v2_refunds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_refund_id text UNIQUE NOT NULL CHECK(provider_refund_id ~ '^re_[A-Za-z0-9]+$'),
 purchase_id uuid NOT NULL REFERENCES public.payment_v2_purchases(id), recurring_invoice_id uuid REFERENCES public.payment_v2_affiliate_recurring_invoices(id),
 source_charge_id text NOT NULL CHECK(source_charge_id ~ '^ch_[A-Za-z0-9]+$'), payment_intent_id text CHECK(payment_intent_id IS NULL OR payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
 amount_cents integer NOT NULL CHECK(amount_cents>=0), currency text NOT NULL CHECK(currency ~ '^[a-z]{3}$'),
 status text NOT NULL CHECK(status IN ('pending','requires_action','succeeded','failed','canceled')),
 reason text CHECK(reason IS NULL OR char_length(reason)<=200), failure_reason text CHECK(failure_reason IS NULL OR char_length(failure_reason)<=200),
 provider_created_at timestamptz NOT NULL, last_provider_event_id text NOT NULL CHECK(char_length(last_provider_event_id) BETWEEN 1 AND 255), last_provider_event_created_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(), updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(id,purchase_id), UNIQUE(provider_refund_id,source_charge_id)
);
CREATE TABLE public.payment_v2_disputes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_dispute_id text UNIQUE NOT NULL CHECK(provider_dispute_id ~ '^du_[A-Za-z0-9]+$'),
 purchase_id uuid NOT NULL REFERENCES public.payment_v2_purchases(id), recurring_invoice_id uuid REFERENCES public.payment_v2_affiliate_recurring_invoices(id),
 source_charge_id text NOT NULL CHECK(source_charge_id ~ '^ch_[A-Za-z0-9]+$'), payment_intent_id text CHECK(payment_intent_id IS NULL OR payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
 amount_cents integer NOT NULL CHECK(amount_cents>=0), currency text NOT NULL CHECK(currency ~ '^[a-z]{3}$'),
 status text NOT NULL CHECK(status IN ('warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','won','lost','prevented')),
 reason text CHECK(reason IS NULL OR char_length(reason)<=200), evidence_due_at timestamptz, provider_created_at timestamptz NOT NULL,
 last_provider_event_id text NOT NULL CHECK(char_length(last_provider_event_id) BETWEEN 1 AND 255), last_provider_event_created_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(), updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(id,purchase_id), UNIQUE(provider_dispute_id,source_charge_id)
);
CREATE TABLE public.payment_v2_financial_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_id uuid NOT NULL REFERENCES public.payment_v2_purchases(id), recurring_invoice_id uuid REFERENCES public.payment_v2_affiliate_recurring_invoices(id),
 source_charge_id text NOT NULL CHECK(source_charge_id ~ '^ch_[A-Za-z0-9]+$'), provider_object_type text NOT NULL CHECK(provider_object_type IN ('refund','dispute')),
 provider_object_id text NOT NULL CHECK(provider_object_id ~ '^(re|du)_[A-Za-z0-9]+$'), review_reason text NOT NULL CHECK(review_reason IN ('PARTIAL_REFUND','PARTIAL_DISPUTE_LOSS','AFFILIATE_ALREADY_DISPATCHING','AFFILIATE_ALREADY_PAID','FINANCIAL_IDENTITY_CONFLICT')),
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','RESOLVED')), amount_cents integer NOT NULL CHECK(amount_cents>=0), currency text NOT NULL CHECK(currency ~ '^[a-z]{3}$'),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(), resolved_at timestamptz, resolution_note text CHECK(resolution_note IS NULL OR char_length(resolution_note)<=500),
 CHECK((state='OPEN' AND resolved_at IS NULL AND resolution_note IS NULL) OR (state='RESOLVED' AND resolved_at IS NOT NULL)), UNIQUE(provider_object_type,provider_object_id,review_reason)
);
CREATE OR REPLACE FUNCTION public.payment_v2_validate_recurring_owner() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$BEGIN
 IF NEW.recurring_invoice_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.payment_v2_affiliate_recurring_invoices i WHERE i.id=NEW.recurring_invoice_id AND i.payment_v2_purchase_id=NEW.purchase_id) THEN RAISE EXCEPTION 'recurring_purchase_mismatch'; END IF; RETURN NEW; END$$;
CREATE TRIGGER payment_v2_refund_owner BEFORE INSERT OR UPDATE ON public.payment_v2_refunds FOR EACH ROW EXECUTE FUNCTION public.payment_v2_validate_recurring_owner();
CREATE TRIGGER payment_v2_dispute_owner BEFORE INSERT OR UPDATE ON public.payment_v2_disputes FOR EACH ROW EXECUTE FUNCTION public.payment_v2_validate_recurring_owner();
CREATE TRIGGER payment_v2_review_owner BEFORE INSERT OR UPDATE ON public.payment_v2_financial_reviews FOR EACH ROW EXECUTE FUNCTION public.payment_v2_validate_recurring_owner();

ALTER TABLE public.payment_v2_refunds ENABLE ROW LEVEL SECURITY; ALTER TABLE public.payment_v2_refunds FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payment_v2_disputes ENABLE ROW LEVEL SECURITY; ALTER TABLE public.payment_v2_disputes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payment_v2_financial_reviews ENABLE ROW LEVEL SECURITY; ALTER TABLE public.payment_v2_financial_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_v2_refunds,public.payment_v2_disputes,public.payment_v2_financial_reviews FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.payment_v2_resolve_financial_source(p_source_charge_id text)
RETURNS TABLE(source_type text,purchase_id uuid,hold_id uuid,recurring_invoice_id uuid,tier text,original_gross_amount integer,currency text,source_charge_id text,source_payment_intent_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$BEGIN
 IF p_source_charge_id !~ '^ch_[A-Za-z0-9]+$' THEN RAISE EXCEPTION 'invalid_source_charge'; END IF;
 RETURN QUERY SELECT CASE WHEN p.tier='og_throne' THEN 'OG_INITIAL' ELSE 'EARLY_BIRD_INITIAL' END,p.id,p.hold_id,NULL::uuid,p.tier,p.gross_amount_cents,p.currency,p.stripe_source_charge_id,p.stripe_source_payment_intent_id FROM public.payment_v2_purchases p WHERE p.stripe_source_charge_id=p_source_charge_id
 UNION ALL SELECT 'EARLY_BIRD_RECURRING',p.id,p.hold_id,i.id,p.tier,i.gross_amount_cents,i.currency,i.stripe_source_charge_id,i.stripe_payment_intent_id FROM public.payment_v2_affiliate_recurring_invoices i JOIN public.payment_v2_purchases p ON p.id=i.payment_v2_purchase_id WHERE i.stripe_source_charge_id=p_source_charge_id;
END$$;

CREATE FUNCTION public.payment_v2_source_charge_blocks_affiliate_payout(p_source_charge_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.payment_v2_refunds WHERE source_charge_id=p_source_charge_id AND status='succeeded')
 OR EXISTS(SELECT 1 FROM public.payment_v2_disputes WHERE source_charge_id=p_source_charge_id AND status IN ('warning_needs_response','warning_under_review','needs_response','under_review','lost'))
 OR EXISTS(SELECT 1 FROM public.payment_v2_financial_reviews WHERE source_charge_id=p_source_charge_id AND state='OPEN')$$;

CREATE FUNCTION public.payment_v2_open_review(p_purchase uuid,p_recurring uuid,p_charge text,p_type text,p_object text,p_reason text,p_amount integer,p_currency text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 INSERT INTO public.payment_v2_financial_reviews(purchase_id,recurring_invoice_id,source_charge_id,provider_object_type,provider_object_id,review_reason,amount_cents,currency)
 VALUES(p_purchase,p_recurring,p_charge,p_type,p_object,p_reason,p_amount,p_currency) ON CONFLICT(provider_object_type,provider_object_id,review_reason) DO NOTHING$$;

CREATE FUNCTION public.payment_v2_apply_refund(p_provider_refund_id text,p_source_charge_id text,p_payment_intent_id text,p_amount_cents integer,p_currency text,p_status text,p_reason text,p_failure_reason text,p_provider_created_at timestamptz,p_provider_event_id text,p_provider_event_created_at timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s record; source_count integer; old public.payment_v2_refunds%rowtype; total bigint; ledger public.affiliate_ledger%rowtype; item_state text;
BEGIN
 PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended('phase12:'||p_source_charge_id,1200));
 SELECT count(*)INTO source_count FROM public.payment_v2_resolve_financial_source(p_source_charge_id); SELECT * INTO s FROM public.payment_v2_resolve_financial_source(p_source_charge_id)LIMIT 1;
 IF source_count=0 THEN RAISE EXCEPTION 'source_missing'; ELSIF source_count>1 THEN RAISE EXCEPTION 'source_ambiguous'; END IF;
 IF p_currency IS DISTINCT FROM s.currency THEN PERFORM public.payment_v2_open_review(s.purchase_id,s.recurring_invoice_id,p_source_charge_id,'refund',p_provider_refund_id,'FINANCIAL_IDENTITY_CONFLICT',p_amount_cents,p_currency);RETURN 'source_currency_mismatch';END IF;
 IF p_payment_intent_id IS NOT NULL AND p_payment_intent_id IS DISTINCT FROM s.source_payment_intent_id THEN PERFORM public.payment_v2_open_review(s.purchase_id,s.recurring_invoice_id,p_source_charge_id,'refund',p_provider_refund_id,'FINANCIAL_IDENTITY_CONFLICT',p_amount_cents,p_currency);RETURN 'source_payment_intent_mismatch';END IF;
 SELECT * INTO old FROM public.payment_v2_refunds WHERE provider_refund_id=p_provider_refund_id FOR UPDATE;
 IF FOUND AND(old.source_charge_id<>p_source_charge_id OR old.currency<>p_currency OR old.amount_cents<>p_amount_cents OR old.provider_created_at<>p_provider_created_at OR old.payment_intent_id IS DISTINCT FROM p_payment_intent_id)THEN
  PERFORM public.payment_v2_open_review(s.purchase_id,s.recurring_invoice_id,p_source_charge_id,'refund',p_provider_refund_id,'FINANCIAL_IDENTITY_CONFLICT',p_amount_cents,p_currency); RETURN 'financial_identity_conflict';
 END IF;
 IF FOUND AND old.last_provider_event_id=p_provider_event_id THEN RETURN 'already_applied'; END IF;
 IF FOUND AND old.last_provider_event_created_at>=p_provider_event_created_at THEN RETURN 'stale_ignored'; END IF;
 INSERT INTO public.payment_v2_refunds(provider_refund_id,purchase_id,recurring_invoice_id,source_charge_id,payment_intent_id,amount_cents,currency,status,reason,failure_reason,provider_created_at,last_provider_event_id,last_provider_event_created_at)
 VALUES(p_provider_refund_id,s.purchase_id,s.recurring_invoice_id,p_source_charge_id,p_payment_intent_id,p_amount_cents,p_currency,p_status,p_reason,p_failure_reason,p_provider_created_at,p_provider_event_id,p_provider_event_created_at)
 ON CONFLICT(provider_refund_id)DO UPDATE SET status=excluded.status,reason=excluded.reason,failure_reason=excluded.failure_reason,last_provider_event_id=excluded.last_provider_event_id,last_provider_event_created_at=excluded.last_provider_event_created_at,updated_at=statement_timestamp();
 SELECT coalesce(sum(amount_cents),0)INTO total FROM public.payment_v2_refunds WHERE source_charge_id=p_source_charge_id AND status='succeeded';
 IF total>s.original_gross_amount THEN RAISE EXCEPTION 'refund_total_exceeds_gross'; END IF;
 IF p_status='succeeded' AND total<s.original_gross_amount THEN PERFORM public.payment_v2_open_review(s.purchase_id,s.recurring_invoice_id,p_source_charge_id,'refund',p_provider_refund_id,'PARTIAL_REFUND',p_amount_cents,p_currency); END IF;
 IF p_status='succeeded' AND total=s.original_gross_amount THEN
  UPDATE public.payment_v2_financial_reviews SET state='RESOLVED',resolved_at=statement_timestamp(),resolution_note='AUTHORITATIVE_FULL_REFUND' WHERE source_charge_id=p_source_charge_id AND review_reason='PARTIAL_REFUND' AND state='OPEN';
  IF s.source_type='OG_INITIAL' THEN
   UPDATE public.payment_v2_purchases SET state='REFUNDED',updated_at=statement_timestamp() WHERE id=s.purchase_id AND state IN('PAID_UNCLAIMED','CLAIMED');
   UPDATE public.payment_v2_holds SET state='REFUNDED',updated_at=statement_timestamp() WHERE id=s.hold_id AND state IN('PAID_UNCLAIMED','CLAIMED');
   UPDATE public.user_subscriptions u SET status='refunded',updated_at=statement_timestamp() FROM public.payment_v2_allocations a,public.payment_v2_purchases p WHERE a.purchase_id=s.purchase_id AND a.entitlement_id=u.id AND p.id=s.purchase_id AND p.state='REFUNDED';
  END IF;
  IF s.recurring_invoice_id IS NOT NULL THEN
   SELECT * INTO ledger FROM public.affiliate_ledger WHERE payment_v2_recurring_invoice_id=s.recurring_invoice_id FOR UPDATE;
  ELSE
   SELECT * INTO ledger FROM public.affiliate_ledger WHERE payment_v2_purchase_id=s.purchase_id AND payment_v2_recurring_invoice_id IS NULL FOR UPDATE;
  END IF;
  IF FOUND THEN
   SELECT execution_status INTO item_state FROM public.affiliate_payout_items WHERE ledger_id=ledger.id;
   IF item_state='dispatching' THEN
    PERFORM public.payment_v2_open_review(s.purchase_id,s.recurring_invoice_id,p_source_charge_id,'refund',p_provider_refund_id,'AFFILIATE_ALREADY_DISPATCHING',p_amount_cents,p_currency);
   ELSIF item_state='succeeded' OR ledger.status='paid' THEN
    PERFORM public.payment_v2_open_review(s.purchase_id,s.recurring_invoice_id,p_source_charge_id,'refund',p_provider_refund_id,'AFFILIATE_ALREADY_PAID',p_amount_cents,p_currency);
   ELSIF ledger.status IN('pending','available') THEN
    UPDATE public.affiliate_ledger SET status='void',void_reason='PAYMENT_REFUNDED',voided_at=statement_timestamp(),updated_at=statement_timestamp() WHERE id=ledger.id;
   END IF;
  END IF;
 END IF;
 RETURN 'applied';
END$$;

CREATE FUNCTION public.payment_v2_apply_dispute(p_provider_dispute_id text,p_source_charge_id text,p_payment_intent_id text,p_amount_cents integer,p_currency text,p_status text,p_reason text,p_evidence_due_at timestamptz,p_provider_created_at timestamptz,p_provider_event_id text,p_provider_event_created_at timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s record;source_count integer;old public.payment_v2_disputes%rowtype;ledger public.affiliate_ledger%rowtype;item_state text;
BEGIN
 PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended('phase12:'||p_source_charge_id,1200));
 SELECT count(*)INTO source_count FROM public.payment_v2_resolve_financial_source(p_source_charge_id); SELECT * INTO s FROM public.payment_v2_resolve_financial_source(p_source_charge_id)LIMIT 1;
 IF source_count=0 THEN RAISE EXCEPTION 'source_missing';ELSIF source_count>1 THEN RAISE EXCEPTION 'source_ambiguous';END IF;
 IF p_currency IS DISTINCT FROM s.currency THEN PERFORM public.payment_v2_open_review(s.purchase_id,s.recurring_invoice_id,p_source_charge_id,'dispute',p_provider_dispute_id,'FINANCIAL_IDENTITY_CONFLICT',p_amount_cents,p_currency);RETURN 'source_currency_mismatch';END IF;
 IF p_payment_intent_id IS NOT NULL AND p_payment_intent_id IS DISTINCT FROM s.source_payment_intent_id THEN PERFORM public.payment_v2_open_review(s.purchase_id,s.recurring_invoice_id,p_source_charge_id,'dispute',p_provider_dispute_id,'FINANCIAL_IDENTITY_CONFLICT',p_amount_cents,p_currency);RETURN 'source_payment_intent_mismatch';END IF;
 IF p_amount_cents>s.original_gross_amount THEN PERFORM public.payment_v2_open_review(s.purchase_id,s.recurring_invoice_id,p_source_charge_id,'dispute',p_provider_dispute_id,'FINANCIAL_IDENTITY_CONFLICT',p_amount_cents,p_currency);RETURN 'dispute_amount_exceeds_gross';END IF;
 SELECT * INTO old FROM public.payment_v2_disputes WHERE provider_dispute_id=p_provider_dispute_id FOR UPDATE;
 IF FOUND AND(old.source_charge_id<>p_source_charge_id OR old.currency<>p_currency OR old.amount_cents<>p_amount_cents OR old.provider_created_at<>p_provider_created_at OR old.payment_intent_id IS DISTINCT FROM p_payment_intent_id)THEN PERFORM public.payment_v2_open_review(s.purchase_id,s.recurring_invoice_id,p_source_charge_id,'dispute',p_provider_dispute_id,'FINANCIAL_IDENTITY_CONFLICT',p_amount_cents,p_currency);RETURN 'financial_identity_conflict';END IF;
 IF FOUND AND old.last_provider_event_id=p_provider_event_id THEN RETURN'already_applied';END IF;IF FOUND AND old.last_provider_event_created_at>=p_provider_event_created_at THEN RETURN'stale_ignored';END IF;
 INSERT INTO public.payment_v2_disputes(provider_dispute_id,purchase_id,recurring_invoice_id,source_charge_id,payment_intent_id,amount_cents,currency,status,reason,evidence_due_at,provider_created_at,last_provider_event_id,last_provider_event_created_at)VALUES(p_provider_dispute_id,s.purchase_id,s.recurring_invoice_id,p_source_charge_id,p_payment_intent_id,p_amount_cents,p_currency,p_status,p_reason,p_evidence_due_at,p_provider_created_at,p_provider_event_id,p_provider_event_created_at)ON CONFLICT(provider_dispute_id)DO UPDATE SET status=excluded.status,reason=excluded.reason,evidence_due_at=excluded.evidence_due_at,last_provider_event_id=excluded.last_provider_event_id,last_provider_event_created_at=excluded.last_provider_event_created_at,updated_at=statement_timestamp();
 IF p_status IN('won','warning_closed','prevented')THEN UPDATE public.payment_v2_financial_reviews SET state='RESOLVED',resolved_at=statement_timestamp(),resolution_note='AUTHORITATIVE_NON_LOSS'WHERE provider_object_type='dispute'AND provider_object_id=p_provider_dispute_id AND review_reason='PARTIAL_DISPUTE_LOSS'AND state='OPEN';END IF;
 IF p_status='lost'AND(s.source_type<>'OG_INITIAL'OR p_amount_cents<s.original_gross_amount)THEN PERFORM public.payment_v2_open_review(s.purchase_id,s.recurring_invoice_id,p_source_charge_id,'dispute',p_provider_dispute_id,'PARTIAL_DISPUTE_LOSS',p_amount_cents,p_currency);END IF;
 IF p_status='lost'AND s.source_type='OG_INITIAL'AND p_amount_cents=s.original_gross_amount THEN
  UPDATE public.payment_v2_purchases SET state='REVOKED',updated_at=statement_timestamp()WHERE id=s.purchase_id AND state<>'REFUNDED';
  UPDATE public.payment_v2_holds SET state='REVOKED',updated_at=statement_timestamp()WHERE id=s.hold_id AND state<>'REFUNDED';
  UPDATE public.user_subscriptions u SET status='revoked',updated_at=statement_timestamp()FROM public.payment_v2_allocations a,public.payment_v2_purchases p WHERE a.purchase_id=s.purchase_id AND a.entitlement_id=u.id AND p.id=s.purchase_id AND p.state='REVOKED';
  SELECT * INTO ledger FROM public.affiliate_ledger WHERE payment_v2_purchase_id=s.purchase_id FOR UPDATE;IF FOUND THEN SELECT execution_status INTO item_state FROM public.affiliate_payout_items WHERE ledger_id=ledger.id;IF ledger.status IN('pending','available')AND item_state IS DISTINCT FROM'dispatching'THEN UPDATE public.affiliate_ledger SET status='void',void_reason='PAYMENT_DISPUTE_LOST',voided_at=statement_timestamp(),updated_at=statement_timestamp()WHERE id=ledger.id;ELSIF item_state='dispatching'THEN PERFORM public.payment_v2_open_review(s.purchase_id,NULL,p_source_charge_id,'dispute',p_provider_dispute_id,'AFFILIATE_ALREADY_DISPATCHING',p_amount_cents,p_currency);ELSIF ledger.status='paid'THEN PERFORM public.payment_v2_open_review(s.purchase_id,NULL,p_source_charge_id,'dispute',p_provider_dispute_id,'AFFILIATE_ALREADY_PAID',p_amount_cents,p_currency);END IF;END IF;
 END IF;RETURN'applied';
END$$;

ALTER TABLE public.affiliate_ledger DROP CONSTRAINT affiliate_ledger_payment_v2_void;
ALTER TABLE public.affiliate_ledger ADD CONSTRAINT affiliate_ledger_payment_v2_void CHECK(
 (attribution_status='VOID_SELF_REFERRAL' AND status='void' AND void_reason='SELF_REFERRAL' AND voided_at IS NOT NULL AND referred_user_id IS NOT NULL)
 OR(attribution_status IS DISTINCT FROM 'VOID_SELF_REFERRAL' AND ((void_reason IS NULL AND voided_at IS NULL) OR(status='void' AND void_reason IN('PAYMENT_REFUNDED','PAYMENT_DISPUTE_LOST') AND voided_at IS NOT NULL))));

create or replace function public.create_affiliate_payout_batch(p_notes text default null) returns uuid language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$ declare batch uuid; begin
 perform pg_advisory_xact_lock(pg_catalog.hashtextextended('affiliate_payout_batch',3200));insert into public.affiliate_payout_batches(notes)values(p_notes)returning id into batch;
 with eligible as(select l.*,case when l.payment_v2_recurring_invoice_id is not null then i.currency else p.currency end cur,case when l.payment_v2_recurring_invoice_id is not null then i.stripe_source_charge_id else p.stripe_source_charge_id end charge,case when h.stripe_connect_destination is not null then h.stripe_connect_destination when pr.stripe_connect_onboarded is true and pr.stripe_connect_account_id~'^acct_[A-Za-z0-9]+$' then pr.stripe_connect_account_id end destination,i.paid_month_number,i.commission_percent recurring_commission_percent from public.affiliate_ledger l left join public.payment_v2_affiliate_recurring_invoices i on i.id=l.payment_v2_recurring_invoice_id left join public.payment_v2_purchases p on p.id=coalesce(l.payment_v2_purchase_id,i.payment_v2_purchase_id) left join public.payment_v2_holds h on h.id=p.hold_id left join public.profiles pr on pr.id=l.affiliate_user_id where l.status='available' and (case when l.payment_v2_purchase_id is null and l.payment_v2_recurring_invoice_id is null then true else not public.payment_v2_source_charge_blocks_affiliate_payout(case when l.payment_v2_recurring_invoice_id is not null then i.stripe_source_charge_id else p.stripe_source_charge_id end) end) and ((l.payment_v2_purchase_id is null and l.payment_v2_recurring_invoice_id is null) or(l.attribution_status='PURCHASER_ATTACHED' and l.referred_user_id is not null and(l.payment_v2_recurring_invoice_id is null or i.reconciliation_status='RECONCILED')))),payable as(select * from eligible where(payment_v2_purchase_id is null and payment_v2_recurring_invoice_id is null)or(charge~'^ch_[A-Za-z0-9]+$' and destination~'^acct_[A-Za-z0-9]+$')),qualified as(select affiliate_user_id from payable group by affiliate_user_id having sum(commission_amount_cents)>=5000),ins as(insert into public.affiliate_payout_items(batch_id,ledger_id,affiliate_user_id,amount_cents,currency,source_charge_id,connect_destination,transfer_idempotency_key,execution_status,recurring_invoice_id,paid_month_number,commission_percent)select batch,e.id,e.affiliate_user_id,e.commission_amount_cents,e.cur,e.charge,e.destination,'pfc03d:'||e.id,case when e.payment_v2_purchase_id is null and e.payment_v2_recurring_invoice_id is null then 'legacy' else 'pending' end,e.payment_v2_recurring_invoice_id,e.paid_month_number,e.recurring_commission_percent from payable e join qualified q using(affiliate_user_id) on conflict(ledger_id)do nothing returning ledger_id,execution_status)update public.affiliate_ledger set status='paid',updated_at=now()where id in(select ledger_id from ins where execution_status='legacy');return batch;end $$;

-- Batch selection and dispatch-time race closure: resolve and lock the authoritative source charge before mutable payout locks.
create or replace function public.payment_v2_begin_payout_dispatch(p_item_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$declare x public.affiliate_payout_items%rowtype;l public.affiliate_ledger%rowtype;r public.payment_v2_affiliate_recurring_invoices%rowtype;p public.payment_v2_purchases%rowtype;h public.payment_v2_holds%rowtype;pr public.profiles%rowtype;destination text;purchase_id uuid;pre_status text;pre_ledger_id uuid;authoritative_charge text;begin
 select execution_status,ledger_id into pre_status,pre_ledger_id from public.affiliate_payout_items where id=p_item_id;if not found then return null;end if;
 if pre_status='dispatching' then select * into x from public.affiliate_payout_items where id=p_item_id for update;if not found or x.execution_status<>'dispatching' then return null;end if;return jsonb_build_object('id',x.id,'ledger_id',x.ledger_id,'amount_cents',x.amount_cents,'currency',x.currency,'source_charge_id',x.source_charge_id,'connect_destination',x.connect_destination,'transfer_idempotency_key',x.transfer_idempotency_key,'execution_status',x.execution_status,'payment_v2_recurring_invoice_id',x.recurring_invoice_id);end if;
 if pre_status<>'pending' then return null;end if;
 select case when l0.payment_v2_recurring_invoice_id is not null then i0.stripe_source_charge_id else p0.stripe_source_charge_id end into authoritative_charge from public.affiliate_ledger l0 left join public.payment_v2_affiliate_recurring_invoices i0 on i0.id=l0.payment_v2_recurring_invoice_id left join public.payment_v2_purchases p0 on p0.id=coalesce(l0.payment_v2_purchase_id,i0.payment_v2_purchase_id) where l0.id=pre_ledger_id;
 if authoritative_charge is null or authoritative_charge!~'^ch_[A-Za-z0-9]+$' then return null;end if;
 perform pg_advisory_xact_lock(pg_catalog.hashtextextended('phase12:'||authoritative_charge,1200));
 select * into x from public.affiliate_payout_items where id=p_item_id for update;if not found then return null;end if;
 if x.execution_status='dispatching' then return jsonb_build_object('id',x.id,'ledger_id',x.ledger_id,'amount_cents',x.amount_cents,'currency',x.currency,'source_charge_id',x.source_charge_id,'connect_destination',x.connect_destination,'transfer_idempotency_key',x.transfer_idempotency_key,'execution_status',x.execution_status,'payment_v2_recurring_invoice_id',x.recurring_invoice_id);end if;
 if x.execution_status<>'pending' or x.attempt_count<>0 or x.ledger_id is distinct from pre_ledger_id then return null;end if;
 select * into l from public.affiliate_ledger where id=x.ledger_id for update;if not found or l.status<>'available' or l.attribution_status<>'PURCHASER_ATTACHED' or l.referred_user_id is null then return null;end if;
 if l.payment_v2_recurring_invoice_id is not null then select * into r from public.payment_v2_affiliate_recurring_invoices where id=l.payment_v2_recurring_invoice_id for update;if not found or r.reconciliation_status<>'RECONCILED' or r.commission_amount_cents is distinct from l.commission_amount_cents or r.stripe_source_charge_id is distinct from authoritative_charge then return null;end if;purchase_id:=r.payment_v2_purchase_id;else purchase_id:=l.payment_v2_purchase_id;end if;
 if purchase_id is null then return null;end if;select * into p from public.payment_v2_purchases where id=purchase_id;if not found then return null;end if;
 if l.payment_v2_recurring_invoice_id is null and(p.stripe_source_charge_id is distinct from authoritative_charge or x.source_charge_id is distinct from authoritative_charge)then return null;end if;
 select * into h from public.payment_v2_holds where id=p.hold_id;if not found then return null;end if;
 if h.stripe_connect_destination is not null then destination:=h.stripe_connect_destination;else select * into pr from public.profiles where id=l.affiliate_user_id;if not found or pr.stripe_connect_onboarded is not true or pr.stripe_connect_account_id is null or pr.stripe_connect_account_id!~'^acct_[A-Za-z0-9]+$' then return null;end if;destination:=pr.stripe_connect_account_id;end if;
 if public.payment_v2_source_charge_blocks_affiliate_payout(authoritative_charge) then return null;end if;
 if l.payment_v2_recurring_invoice_id is not null then update public.affiliate_payout_items set amount_cents=r.commission_amount_cents,currency=r.currency,source_charge_id=r.stripe_source_charge_id,connect_destination=destination,recurring_invoice_id=r.id,paid_month_number=r.paid_month_number,commission_percent=r.commission_percent,execution_status='dispatching',attempt_count=1,updated_at=now() where id=p_item_id returning * into x;else update public.affiliate_payout_items set connect_destination=destination,execution_status='dispatching',attempt_count=1,updated_at=now() where id=p_item_id returning * into x;end if;
 if x.source_charge_id!~'^ch_[A-Za-z0-9]+$' or x.connect_destination!~'^acct_[A-Za-z0-9]+$' or x.currency!~'^[a-z]{3}$' or x.amount_cents<0 then raise exception 'invalid_dispatch_payload';end if;
 return jsonb_build_object('id',x.id,'ledger_id',x.ledger_id,'amount_cents',x.amount_cents,'currency',x.currency,'source_charge_id',x.source_charge_id,'connect_destination',x.connect_destination,'transfer_idempotency_key',x.transfer_idempotency_key,'execution_status',x.execution_status,'payment_v2_recurring_invoice_id',x.recurring_invoice_id);end$$;

INSERT INTO public.admin_roles(role_key,display_name) VALUES('billing_operator','Billing operator');
INSERT INTO public.admin_capabilities(capability_key,description) VALUES('billing.financial.read','Read bounded refund, dispute, and finance review evidence');
INSERT INTO public.admin_role_capabilities(role_key,capability_key) VALUES('founder_admin','billing.financial.read'),('billing_operator','billing.financial.read');

CREATE FUNCTION public.admin_list_payment_v2_financial_events(p_actor_user_id uuid,p_before_created_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 50,p_kind text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$DECLARE result jsonb; n integer; actor text;BEGIN
 IF NOT public.admin_actor_has_capability(p_actor_user_id,'billing.financial.read') THEN RAISE EXCEPTION 'admin_forbidden';END IF;
 IF p_limit NOT BETWEEN 1 AND 100 OR p_kind IS NOT NULL AND p_kind NOT IN('refund','dispute','finance-review') OR (p_before_created_at IS NULL)<>(p_before_id IS NULL) THEN RAISE EXCEPTION 'invalid_parameters';END IF;
 WITH events AS(
  SELECT r.id,'refund'::text kind,p.tier,CASE WHEN i.id IS NULL THEN CASE WHEN p.tier='og_throne'THEN'OG_INITIAL'ELSE'EARLY_BIRD_INITIAL'END ELSE'EARLY_BIRD_RECURRING'END source_type,r.amount_cents,r.currency,r.status provider_status,CASE WHEN p.state='REFUNDED'THEN'REFUNDED' ELSE CASE WHEN public.payment_v2_source_charge_blocks_affiliate_payout(r.source_charge_id)THEN'FINANCE_REVIEW_REQUIRED'ELSE'NONE'END END entitlement_effect,r.provider_created_at,r.updated_at,NULL::timestamptz evidence_due_at,r.created_at FROM public.payment_v2_refunds r JOIN public.payment_v2_purchases p ON p.id=r.purchase_id LEFT JOIN public.payment_v2_affiliate_recurring_invoices i ON i.id=r.recurring_invoice_id
  UNION ALL SELECT d.id,'dispute',p.tier,CASE WHEN i.id IS NULL THEN CASE WHEN p.tier='og_throne'THEN'OG_INITIAL'ELSE'EARLY_BIRD_INITIAL'END ELSE'EARLY_BIRD_RECURRING'END,d.amount_cents,d.currency,d.status,CASE WHEN p.state='REVOKED'THEN'REVOKED' ELSE CASE WHEN public.payment_v2_source_charge_blocks_affiliate_payout(d.source_charge_id)THEN'FINANCE_REVIEW_REQUIRED'ELSE'NONE'END END,d.provider_created_at,d.updated_at,d.evidence_due_at,d.created_at FROM public.payment_v2_disputes d JOIN public.payment_v2_purchases p ON p.id=d.purchase_id LEFT JOIN public.payment_v2_affiliate_recurring_invoices i ON i.id=d.recurring_invoice_id
  UNION ALL SELECT f.id,'finance-review',p.tier,CASE WHEN i.id IS NULL THEN CASE WHEN p.tier='og_throne'THEN'OG_INITIAL'ELSE'EARLY_BIRD_INITIAL'END ELSE'EARLY_BIRD_RECURRING'END,f.amount_cents,f.currency,f.state,'FINANCE_REVIEW_REQUIRED',f.created_at,coalesce(f.resolved_at,f.created_at),NULL::timestamptz,f.created_at FROM public.payment_v2_financial_reviews f JOIN public.payment_v2_purchases p ON p.id=f.purchase_id LEFT JOIN public.payment_v2_affiliate_recurring_invoices i ON i.id=f.recurring_invoice_id), page AS(SELECT * FROM events WHERE(p_kind IS NULL OR kind=p_kind)AND(p_before_created_at IS NULL OR(created_at,id)<(p_before_created_at,p_before_id))ORDER BY created_at DESC,id DESC LIMIT p_limit)
 SELECT coalesce(jsonb_agg(to_jsonb(page)ORDER BY created_at DESC,id DESC),'[]'::jsonb),count(*) INTO result,n FROM page;
 actor:=CASE WHEN public.admin_actor_has_active_role(p_actor_user_id,'founder_admin')THEN'founder_admin'ELSE'admin_operator'END;PERFORM public.append_governance_audit_event(p_actor_user_id,actor,'billing.financial.read','billing_financial_events','bounded_page','billing',NULL,'success',NULL,NULL,gen_random_uuid(),NULL,jsonb_build_object('returned_count',n,'filter',coalesce(p_kind,'all'),'limit',p_limit),'{}'::jsonb,NULL);RETURN jsonb_build_object('events',result);END$$;
REVOKE ALL ON FUNCTION public.admin_list_payment_v2_financial_events(uuid,timestamptz,uuid,integer,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_payment_v2_financial_events(uuid,timestamptz,uuid,integer,text) TO service_role;

REVOKE ALL ON FUNCTION public.payment_v2_resolve_financial_source(text),public.payment_v2_source_charge_blocks_affiliate_payout(text),public.payment_v2_apply_refund(text,text,text,integer,text,text,text,text,timestamptz,text,timestamptz),public.payment_v2_apply_dispute(text,text,text,integer,text,text,text,timestamptz,timestamptz,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.payment_v2_resolve_financial_source(text),public.payment_v2_apply_refund(text,text,text,integer,text,text,text,text,timestamptz,text,timestamptz),public.payment_v2_apply_dispute(text,text,text,integer,text,text,text,timestamptz,timestamptz,text,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.payment_v2_open_review(uuid,uuid,text,text,text,text,integer,text),public.payment_v2_validate_recurring_owner(),public.payment_v2_source_charge_blocks_affiliate_payout(text) FROM PUBLIC,anon,authenticated,service_role;
SELECT pg_notify('pgrst','reload schema');
COMMIT;
