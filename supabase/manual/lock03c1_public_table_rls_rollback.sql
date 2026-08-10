-- EMERGENCY MANUAL ROLLBACK ONLY.
-- Applying this file would reopen a known public-data security exposure.
-- It requires explicit human approval and must never run automatically.
-- SOURCE ONLY: this file does not restore or modify application data.

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
  left join pg_policy p on p.polrelid = c.oid and p.polname = 'lock03c1_deny_anon_authenticated'
  where c.oid is null or c.relkind not in ('r', 'p') or not c.relrowsecurity or p.oid is null;

  if drifted is not null then
    raise exception using errcode = 'P0001', message = 'LOCK03C1_ROLLBACK_DRIFT';
  end if;
end
$$;

drop policy lock03c1_deny_anon_authenticated on public.lora_status_events;
alter table public.lora_status_events disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.sf_users;
alter table public.sf_users disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.models;
alter table public.models disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.model_enrollments;
alter table public.model_enrollments disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.platform_connections;
alter table public.platform_connections disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.approved_media;
alter table public.approved_media disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.posting_rules;
alter table public.posting_rules disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.scheduled_posts;
alter table public.scheduled_posts disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.post_logs;
alter table public.post_logs disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.campaign_links;
alter table public.campaign_links disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.caption_templates;
alter table public.caption_templates disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.hashtag_sets;
alter table public.hashtag_sets disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.cta_variants;
alter table public.cta_variants disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.content_generation_jobs;
alter table public.content_generation_jobs disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.content_usage_log;
alter table public.content_usage_log disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.autopost_settings;
alter table public.autopost_settings disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.autopost_runs;
alter table public.autopost_runs disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.autopost_run_results;
alter table public.autopost_run_results disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.pfc03000_backup_profiles;
alter table public.pfc03000_backup_profiles disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.pfc03000_backup_referral_codes;
alter table public.pfc03000_backup_referral_codes disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.pfc03000_backup_referral_tracking;
alter table public.pfc03000_backup_referral_tracking disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.pfc03000_backup_referrals;
alter table public.pfc03000_backup_referrals disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.pfc03000_backup_commission_earnings;
alter table public.pfc03000_backup_commission_earnings disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.pfc03000_backup_commissions;
alter table public.pfc03000_backup_commissions disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.pfc03000_backup_affiliate_ledger;
alter table public.pfc03000_backup_affiliate_ledger disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.pfc03000_backup_affiliate_payout_batches;
alter table public.pfc03000_backup_affiliate_payout_batches disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.pfc03000_backup_affiliate_payout_items;
alter table public.pfc03000_backup_affiliate_payout_items disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.pfc03000_backup_payouts;
alter table public.pfc03000_backup_payouts disable row level security;

drop policy lock03c1_deny_anon_authenticated on public.pfc03000_backup_catalog_snapshot;
alter table public.pfc03000_backup_catalog_snapshot disable row level security;

commit;
