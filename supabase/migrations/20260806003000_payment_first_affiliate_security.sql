-- Forward-only Payment-First affiliate security boundary.
begin;

do $assert$
declare
  object_name text;
  expected_tables constant text[] := array[
    'profiles','referral_codes','referral_tracking','referrals','commission_earnings',
    'commissions','affiliate_ledger','affiliate_payout_batches','affiliate_payout_items','payouts'
  ];
  expected_functions constant text[] := array[
    'apply_referral_code(uuid,character varying)',
    'calculate_affiliate_commission(uuid,character varying,numeric,boolean)',
    'calculate_commission(uuid,character varying,numeric)',
    'calculate_commission_rate(text,text,integer)',
    'clawback_affiliate_commission(text,text)',
    'complete_referral_reward(uuid)',
    'create_affiliate_payout_batch(text)',
    'generate_referral_code()',
    'generate_referral_code(uuid,character varying)',
    'generate_unique_referral_code()',
    'get_profile_by_referral_code(text)',
    'process_referral_reward(uuid,text)',
    'release_affiliate_commissions()',
    'get_user_stats(uuid)',
    'handle_new_user()',
    'initialize_new_user()'
  ];
  fn text;
begin
  foreach object_name in array expected_tables loop
    if not exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=object_name and c.relkind in ('r','p')) then
      raise exception 'PFC_CORE_02C_CATALOG_MISMATCH: public.% must be a table', object_name;
    end if;
  end loop;
  if not exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='affiliate_payout_queue' and c.relkind='v') then
    raise exception 'PFC_CORE_02C_CATALOG_MISMATCH: affiliate_payout_queue must be a view';
  end if;
  foreach fn in array expected_functions loop
    if pg_catalog.to_regprocedure('public.' || fn) is null then raise exception 'PFC_CORE_02C_CATALOG_MISMATCH: missing function %', fn; end if;
    if (select l.lanname from pg_catalog.pg_proc p join pg_catalog.pg_language l on l.oid=p.prolang where p.oid=pg_catalog.to_regprocedure('public.' || fn)) <> 'plpgsql' then
      raise exception 'PFC_CORE_02C_CATALOG_MISMATCH: function % is not plpgsql', fn;
    end if;
  end loop;
  if pg_catalog.to_regprocedure('public.void_affiliate_commissions(text)') is not null then raise exception 'PFC_CORE_02C_CATALOG_MISMATCH: void function must remain absent'; end if;
  if pg_catalog.pg_get_function_result('public.apply_referral_code(uuid,character varying)'::regprocedure) <> 'jsonb'
    or pg_catalog.pg_get_function_result('public.calculate_affiliate_commission(uuid,character varying,numeric,boolean)'::regprocedure) <> 'TABLE(commission_amount numeric, commission_rate numeric, tier_name character varying)'
    or pg_catalog.pg_get_function_result('public.calculate_commission(uuid,character varying,numeric)'::regprocedure) <> 'jsonb'
    or pg_catalog.pg_get_function_result('public.calculate_commission_rate(text,text,integer)'::regprocedure) <> 'numeric'
    or pg_catalog.pg_get_function_result('public.clawback_affiliate_commission(text,text)'::regprocedure) <> 'void'
    or pg_catalog.pg_get_function_result('public.complete_referral_reward(uuid)'::regprocedure) <> 'boolean'
    or pg_catalog.pg_get_function_result('public.create_affiliate_payout_batch(text)'::regprocedure) <> 'uuid'
    or pg_catalog.pg_get_function_result('public.generate_referral_code()'::regprocedure) <> 'text'
    or pg_catalog.pg_get_function_result('public.generate_referral_code(uuid,character varying)'::regprocedure) <> 'character varying'
    or pg_catalog.pg_get_function_result('public.generate_unique_referral_code()'::regprocedure) <> 'text'
    or pg_catalog.pg_get_function_result('public.get_profile_by_referral_code(text)'::regprocedure) <> 'TABLE(user_id uuid, email text, referral_code text)'
    or pg_catalog.pg_get_function_result('public.process_referral_reward(uuid,text)'::regprocedure) <> 'boolean'
    or pg_catalog.pg_get_function_result('public.release_affiliate_commissions()'::regprocedure) <> 'void'
    or pg_catalog.pg_get_function_result('public.get_user_stats(uuid)'::regprocedure) <> 'TABLE(total_generations bigint, total_collections bigint, total_tokens_spent integer, total_referrals bigint, current_streak integer)'
    or pg_catalog.pg_get_function_result('public.handle_new_user()'::regprocedure) <> 'trigger'
    or pg_catalog.pg_get_function_result('public.initialize_new_user()'::regprocedure) <> 'trigger' then
    raise exception 'PFC_CORE_02C_CATALOG_MISMATCH: function return contract';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger where tgname='on_auth_user_created' and tgrelid='auth.users'::regclass and tgfoid='public.handle_new_user()'::regprocedure and not tgisinternal)
    or not exists (select 1 from pg_catalog.pg_trigger where tgname='on_profile_created' and tgrelid='public.profiles'::regclass and tgfoid='public.initialize_new_user()'::regprocedure and not tgisinternal) then
    raise exception 'PFC_CORE_02C_CATALOG_MISMATCH: profile trigger chain';
  end if;
end
$assert$;

revoke all privileges on table public.profiles, public.referral_codes, public.referral_tracking,
  public.referrals, public.commission_earnings, public.commissions, public.affiliate_ledger,
  public.affiliate_payout_batches, public.affiliate_payout_items, public.payouts
  from public, anon, authenticated, service_role;
revoke all privileges on table public.affiliate_payout_queue from public, anon, authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.referral_codes enable row level security;
alter table public.referral_tracking enable row level security;
alter table public.referrals enable row level security;
alter table public.commission_earnings enable row level security;
alter table public.commissions enable row level security;
alter table public.affiliate_ledger enable row level security;
alter table public.affiliate_payout_batches enable row level security;
alter table public.affiliate_payout_items enable row level security;
alter table public.payouts enable row level security;

do $policies$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_catalog.pg_policies where schemaname='public' and tablename in ('profiles','referrals') loop
    execute format('drop policy %I on %I.%I',p.policyname,p.schemaname,p.tablename);
  end loop;
end
$policies$;
create policy profiles_authenticated_own_select on public.profiles for select to authenticated using (user_id = auth.uid());
create policy referrals_authenticated_participant_select on public.referrals for select to authenticated using (referrer_user_id = auth.uid() or referred_user_id = auth.uid());

grant select on table public.profiles, public.referrals to authenticated;
grant select on table public.profiles, public.referrals, public.commission_earnings,
  public.referral_codes, public.affiliate_payout_items, public.affiliate_payout_batches to service_role;
grant update (stripe_customer_id, stripe_connect_account_id, stripe_connect_onboarded) on public.profiles to service_role;

do $sequences$
declare s record;
begin
  for s in
    select ns.nspname, seq.relname
    from pg_catalog.pg_class seq
    join pg_catalog.pg_namespace ns on ns.oid=seq.relnamespace
    join pg_catalog.pg_depend d on d.objid=seq.oid and d.deptype in ('a','i')
    join pg_catalog.pg_class tab on tab.oid=d.refobjid
    where seq.relkind='S' and ns.nspname='public'
      and tab.relname = any(array['profiles','referral_codes','referral_tracking','referrals','commission_earnings','commissions','affiliate_ledger','affiliate_payout_batches','affiliate_payout_items','payouts'])
  loop
    execute format('revoke all privileges on sequence %I.%I from public, anon, authenticated, service_role',s.nspname,s.relname);
  end loop;
end
$sequences$;

do $functions$
declare fn regprocedure;
begin
  foreach fn in array array[
    'public.apply_referral_code(uuid,character varying)'::regprocedure,
    'public.calculate_affiliate_commission(uuid,character varying,numeric,boolean)'::regprocedure,
    'public.calculate_commission(uuid,character varying,numeric)'::regprocedure,
    'public.calculate_commission_rate(text,text,integer)'::regprocedure,
    'public.clawback_affiliate_commission(text,text)'::regprocedure,
    'public.complete_referral_reward(uuid)'::regprocedure,
    'public.create_affiliate_payout_batch(text)'::regprocedure,
    'public.generate_referral_code()'::regprocedure,
    'public.generate_referral_code(uuid,character varying)'::regprocedure,
    'public.generate_unique_referral_code()'::regprocedure,
    'public.get_profile_by_referral_code(text)'::regprocedure,
    'public.process_referral_reward(uuid,text)'::regprocedure,
    'public.release_affiliate_commissions()'::regprocedure,
    'public.get_user_stats(uuid)'::regprocedure,
    'public.handle_new_user()'::regprocedure,
    'public.initialize_new_user()'::regprocedure
  ] loop
    execute format('alter function %s owner to postgres',fn);
    execute format('revoke all privileges on function %s from public, anon, authenticated, service_role',fn);
    execute format('alter function %s set search_path to pg_catalog, public, pg_temp',fn);
  end loop;
end
$functions$;

alter function public.release_affiliate_commissions() security definer set search_path to pg_catalog, pg_temp;
alter function public.create_affiliate_payout_batch(text) security invoker set search_path to pg_catalog, pg_temp;
alter function public.generate_referral_code() security invoker set search_path to pg_catalog, pg_temp;
alter function public.initialize_new_user() security invoker set search_path to pg_catalog, pg_temp;
alter function public.complete_referral_reward(uuid) security definer;
alter function public.get_profile_by_referral_code(text) security definer;
alter function public.process_referral_reward(uuid,text) security definer;
alter function public.get_user_stats(uuid) security definer;
alter function public.handle_new_user() security definer;
grant execute on function public.release_affiliate_commissions() to service_role;

commit;
