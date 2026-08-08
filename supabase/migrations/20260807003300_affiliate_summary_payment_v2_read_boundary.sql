begin;

create function public.get_my_payment_v2_affiliate_ledger()
returns table(
  id uuid,
  commission_amount_cents integer,
  status text,
  created_at timestamptz,
  is_initial_purchase boolean,
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
         l.attribution_status = 'VOID_SELF_REFERRAL'
    from public.affiliate_ledger l
   where l.affiliate_user_id = affiliate_profile_id
     and (l.payment_v2_purchase_id is not null or l.payment_v2_recurring_invoice_id is not null)
   order by l.created_at desc, l.id desc;
end
$$;

alter function public.get_my_payment_v2_affiliate_ledger() owner to postgres;
revoke all on function public.get_my_payment_v2_affiliate_ledger() from public, anon, service_role;
grant execute on function public.get_my_payment_v2_affiliate_ledger() to authenticated;

select pg_notify('pgrst', 'reload schema');
commit;
