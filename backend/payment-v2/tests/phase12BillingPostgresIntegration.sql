\set ON_ERROR_STOP on
DO $$
DECLARE h uuid;p uuid;e uuid;r text;d text;
BEGIN
 select hold_id into h from public.payment_v2_acquire_hold(extensions.digest('phase12-og','sha256'),'og_throne',now()+interval '1 hour','PHASE12');
 perform public.payment_v2_associate_session(h,extensions.digest('phase12-og','sha256'),'cs_phase12_og');
 perform public.payment_v2_record_paid_with_charge(h,extensions.digest('phase12-og','sha256'),'cs_phase12_og','cus_phase12','price_og','pi_phase12',null,'evt_paid_phase12',now(),10000,'usd','pi_phase12','ch_phase12',null);
 select id into p from public.payment_v2_purchases where hold_id=h;
 perform public.payment_v2_apply_refund('re_pending1','ch_phase12','pi_phase12',1000,'usd','pending',null,null,now(),'evt_re_pending1',now());
 if (select state from public.payment_v2_purchases where id=p)<>'PAID_UNCLAIMED' then raise exception 'pending_mutated';end if;
 perform public.payment_v2_apply_refund('re_partial1','ch_phase12','pi_phase12',4000,'usd','succeeded',null,null,now(),'evt_re_partial1',now()+interval '1 second');
 if not public.payment_v2_source_charge_blocks_affiliate_payout('ch_phase12') or not exists(select 1 from public.payment_v2_financial_reviews where review_reason='PARTIAL_REFUND'and state='OPEN')then raise exception 'partial_not_blocked';end if;
 perform public.payment_v2_apply_refund('re_full1','ch_phase12','pi_phase12',6000,'usd','succeeded',null,null,now(),'evt_re_full1',now()+interval '2 seconds');
 if (select state from public.payment_v2_purchases where id=p)<>'REFUNDED'or(select state from public.payment_v2_holds where id=h)<>'REFUNDED'or exists(select 1 from public.payment_v2_financial_reviews where review_reason='PARTIAL_REFUND'and state='OPEN')then raise exception 'full_refund_failed';end if;
 r:=public.payment_v2_apply_refund('re_full1','ch_phase12','pi_phase12',6000,'usd','succeeded',null,null,now(),'evt_re_full1',now()+interval '2 seconds');if r<>'already_applied'then raise exception 'refund_replay';end if;
 begin perform public.payment_v2_apply_refund('re_over1','ch_phase12','pi_phase12',1,'usd','succeeded',null,null,now(),'evt_over',now()+interval '3 seconds');raise exception 'overgross_accepted';exception when others then if sqlerrm='overgross_accepted'then raise;end if;end;
 if public.payment_v2_apply_refund('re_badcurrency1','ch_phase12','pi_phase12',1,'eur','pending',null,null,now(),'evt_currency',now())<>'source_currency_mismatch'then raise exception 'currency_not_blocked';end if;
 if exists(select 1 from public.payment_v2_refunds where provider_refund_id='re_badcurrency1')then raise exception 'invalid_snapshot_saved';end if;
 -- Stronger REFUNDED state survives a later lost dispute.
 perform public.payment_v2_apply_dispute('du_afterrefund1','ch_phase12','pi_phase12',10000,'usd','lost','fraudulent',null,now(),'evt_du_lost',now()+interval '4 seconds');
 if(select state from public.payment_v2_purchases where id=p)<>'REFUNDED'or(select state from public.payment_v2_holds where id=h)<>'REFUNDED'then raise exception 'refunded_downgraded';end if;
 perform public.payment_v2_apply_dispute('du_open1','ch_phase12','pi_phase12',1000,'usd','needs_response','fraudulent',now()+interval '1 day',now(),'evt_du_open1',now()+interval '5 seconds');
 perform public.payment_v2_apply_dispute('du_open1','ch_phase12','pi_phase12',1000,'usd','won','fraudulent',null,now(),'evt_du_won',now()+interval '6 seconds');
 if exists(select 1 from public.payment_v2_financial_reviews where provider_object_id='du_open1'and review_reason='PARTIAL_DISPUTE_LOSS'and state='OPEN')then raise exception 'dispute_review_not_resolved';end if;
END$$;
select 'phase12_postgres_scenarios=12';
