begin;

do $$
declare
  drifted text[];
begin
  select array_agg(target.name order by target.name)
    into drifted
  from (values
      ('lora_status_events'),
      ('sf_users'),
      ('models'),
      ('model_enrollments'),
      ('platform_connections'),
      ('approved_media'),
      ('posting_rules'),
      ('scheduled_posts'),
      ('post_logs'),
      ('campaign_links'),
      ('caption_templates'),
      ('hashtag_sets'),
      ('cta_variants'),
      ('content_generation_jobs'),
      ('content_usage_log'),
      ('autopost_settings'),
      ('autopost_runs'),
      ('autopost_run_results'),
      ('pfc03000_backup_profiles'),
      ('pfc03000_backup_referral_codes'),
      ('pfc03000_backup_referral_tracking'),
      ('pfc03000_backup_referrals'),
      ('pfc03000_backup_commission_earnings'),
      ('pfc03000_backup_commissions'),
      ('pfc03000_backup_affiliate_ledger'),
      ('pfc03000_backup_affiliate_payout_batches'),
      ('pfc03000_backup_affiliate_payout_items'),
      ('pfc03000_backup_payouts'),
      ('pfc03000_backup_catalog_snapshot')
  ) as target(name)
  left join pg_namespace n on n.nspname = 'public'
  left join pg_class c on c.relnamespace = n.oid and c.relname = target.name
  where c.oid is null or c.relkind not in ('r', 'p') or c.relrowsecurity;

  if drifted is not null then
    raise exception using errcode = 'P0001', message = 'LOCK03C1_DRIFT';
  end if;
end
$$;

alter table public.lora_status_events enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.lora_status_events
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.sf_users enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.sf_users
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.models enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.models
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.model_enrollments enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.model_enrollments
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.platform_connections enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.platform_connections
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.approved_media enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.approved_media
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.posting_rules enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.posting_rules
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.scheduled_posts enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.scheduled_posts
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.post_logs enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.post_logs
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.campaign_links enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.campaign_links
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.caption_templates enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.caption_templates
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.hashtag_sets enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.hashtag_sets
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.cta_variants enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.cta_variants
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.content_generation_jobs enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.content_generation_jobs
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.content_usage_log enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.content_usage_log
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.autopost_settings enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.autopost_settings
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.autopost_runs enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.autopost_runs
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.autopost_run_results enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.autopost_run_results
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.pfc03000_backup_profiles enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.pfc03000_backup_profiles
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.pfc03000_backup_referral_codes enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.pfc03000_backup_referral_codes
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.pfc03000_backup_referral_tracking enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.pfc03000_backup_referral_tracking
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.pfc03000_backup_referrals enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.pfc03000_backup_referrals
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.pfc03000_backup_commission_earnings enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.pfc03000_backup_commission_earnings
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.pfc03000_backup_commissions enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.pfc03000_backup_commissions
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.pfc03000_backup_affiliate_ledger enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.pfc03000_backup_affiliate_ledger
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.pfc03000_backup_affiliate_payout_batches enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.pfc03000_backup_affiliate_payout_batches
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.pfc03000_backup_affiliate_payout_items enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.pfc03000_backup_affiliate_payout_items
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.pfc03000_backup_payouts enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.pfc03000_backup_payouts
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.pfc03000_backup_catalog_snapshot enable row level security;
create policy lock03c1_deny_anon_authenticated
  on public.pfc03000_backup_catalog_snapshot
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

do $$
declare
  invalid_count integer;
begin
  select count(*)
    into invalid_count
  from (values
      ('lora_status_events'),
      ('sf_users'),
      ('models'),
      ('model_enrollments'),
      ('platform_connections'),
      ('approved_media'),
      ('posting_rules'),
      ('scheduled_posts'),
      ('post_logs'),
      ('campaign_links'),
      ('caption_templates'),
      ('hashtag_sets'),
      ('cta_variants'),
      ('content_generation_jobs'),
      ('content_usage_log'),
      ('autopost_settings'),
      ('autopost_runs'),
      ('autopost_run_results'),
      ('pfc03000_backup_profiles'),
      ('pfc03000_backup_referral_codes'),
      ('pfc03000_backup_referral_tracking'),
      ('pfc03000_backup_referrals'),
      ('pfc03000_backup_commission_earnings'),
      ('pfc03000_backup_commissions'),
      ('pfc03000_backup_affiliate_ledger'),
      ('pfc03000_backup_affiliate_payout_batches'),
      ('pfc03000_backup_affiliate_payout_items'),
      ('pfc03000_backup_payouts'),
      ('pfc03000_backup_catalog_snapshot')
  ) as target(name)
  left join pg_namespace n on n.nspname = 'public'
  left join pg_class c
    on c.relnamespace = n.oid
   and c.relname = target.name
   and c.relkind in ('r', 'p')
  left join pg_policy p
    on p.polrelid = c.oid
   and p.polname = 'lock03c1_deny_anon_authenticated'
  where c.oid is null
     or not c.relrowsecurity
     or p.oid is null
     or p.polpermissive
     or p.polcmd <> '*'
     or (select array_agg(r.rolname order by r.rolname)
           from unnest(p.polroles) role_oid
           join pg_roles r on r.oid = role_oid)
        is distinct from array['anon', 'authenticated']::name[]
     or pg_get_expr(p.polqual, p.polrelid) <> 'false'
     or pg_get_expr(p.polwithcheck, p.polrelid) <> 'false';

  if invalid_count <> 0 then
    raise exception using errcode = 'P0001', message = 'LOCK03C1_POSTCONDITION_FAILED';
  end if;
end
$$;

commit;
