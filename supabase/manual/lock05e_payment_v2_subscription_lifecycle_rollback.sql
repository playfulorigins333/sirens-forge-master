-- REPOSITORY ARTIFACT ONLY. Removes only the additive LOCK-05E RPC.
begin;
do $$
declare v_oid oid;
begin
  v_oid := to_regprocedure('public.payment_v2_apply_early_bird_subscription_lifecycle(text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz)');
  if v_oid is null then raise exception 'lock05e_function_missing'; end if;
  if exists (select 1 from pg_depend where refobjid=v_oid) then
    raise exception 'lock05e_unexpected_function_dependency';
  end if;
end $$;
drop function public.payment_v2_apply_early_bird_subscription_lifecycle(text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz) restrict;
commit;
