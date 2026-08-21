-- Source-only final Supabase least-privilege hardening. Production application requires separate explicit authorization.
begin;

do $preflight$
declare bad boolean;
begin
  if (select count(*) from (values ('_backup_autopost_rules_before_content_payload_20250628_001','DELETE'),
      ('_backup_autopost_rules_before_content_payload_20250628_001','INSERT'),
      ('_backup_autopost_rules_before_content_payload_20250628_001','SELECT'),
      ('_backup_autopost_rules_before_content_payload_20250628_001','UPDATE'),
      ('autopost_job_logs','DELETE'),
      ('autopost_job_logs','INSERT'),
      ('autopost_job_logs','UPDATE'),
      ('autopost_jobs','DELETE'),
      ('autopost_jobs','INSERT'),
      ('autopost_jobs','UPDATE'),
      ('autopost_rules','DELETE'),
      ('creator_platform_accounts','DELETE'),
      ('creator_platform_accounts','INSERT'),
      ('creator_platform_accounts','UPDATE'),
      ('creator_publishing_ai_twin_consents','DELETE'),
      ('creator_publishing_ai_twin_consents','INSERT'),
      ('creator_publishing_ai_twin_consents','UPDATE'),
      ('creator_publishing_audit_events','DELETE'),
      ('creator_publishing_audit_events','INSERT'),
      ('creator_publishing_audit_events','UPDATE'),
      ('creator_publishing_co_performer_records','DELETE'),
      ('creator_publishing_co_performer_records','INSERT'),
      ('creator_publishing_co_performer_records','UPDATE'),
      ('creator_publishing_compliance_reviews','DELETE'),
      ('creator_publishing_compliance_reviews','INSERT'),
      ('creator_publishing_compliance_reviews','UPDATE'),
      ('creator_publishing_content_packages','DELETE'),
      ('creator_publishing_content_packages','INSERT'),
      ('creator_publishing_content_packages','UPDATE'),
      ('creator_publishing_creator_verifications','DELETE'),
      ('creator_publishing_creator_verifications','INSERT'),
      ('creator_publishing_creator_verifications','UPDATE'),
      ('creator_publishing_media_assets','DELETE'),
      ('creator_publishing_media_assets','INSERT'),
      ('creator_publishing_media_assets','UPDATE'),
      ('creator_publishing_media_upload_intents','DELETE'),
      ('creator_publishing_media_upload_intents','INSERT'),
      ('creator_publishing_media_upload_intents','SELECT'),
      ('creator_publishing_media_upload_intents','UPDATE'),
      ('creator_publishing_plans','DELETE'),
      ('creator_publishing_plans','INSERT'),
      ('creator_publishing_plans','UPDATE'),
      ('creator_publishing_platform_jobs','DELETE'),
      ('creator_publishing_platform_jobs','INSERT'),
      ('creator_publishing_platform_jobs','UPDATE'),
      ('creator_publishing_queue_tasks','DELETE'),
      ('creator_publishing_queue_tasks','INSERT'),
      ('creator_publishing_queue_tasks','UPDATE'),
      ('creator_publishing_trusted_reviewers','DELETE'),
      ('creator_publishing_trusted_reviewers','INSERT'),
      ('creator_publishing_trusted_reviewers','SELECT'),
      ('creator_publishing_trusted_reviewers','UPDATE'),
      ('crypto_payments','DELETE'),
      ('crypto_payments','INSERT'),
      ('crypto_payments','UPDATE'),
      ('crypto_wallet_addresses','DELETE'),
      ('subscription_history','DELETE'),
      ('subscription_history','INSERT'),
      ('subscription_history','UPDATE'),
      ('subscription_tiers','DELETE'),
      ('subscription_tiers','INSERT'),
      ('subscription_tiers','UPDATE'),
      ('user_loras','DELETE'),
      ('user_subscriptions','DELETE'),
      ('user_subscriptions','INSERT'),
      ('user_subscriptions','UPDATE'),
      ('creator_publishing_fanvue_attempts','SELECT')) expected(rel,priv)) <> 67 then raise exception 'FINAL_LP_INTERNAL_STALE_COUNT'; end if;
  if exists (select 1 from (values ('_backup_autopost_rules_before_content_payload_20250628_001','DELETE'),
      ('_backup_autopost_rules_before_content_payload_20250628_001','INSERT'),
      ('_backup_autopost_rules_before_content_payload_20250628_001','SELECT'),
      ('_backup_autopost_rules_before_content_payload_20250628_001','UPDATE'),
      ('autopost_job_logs','DELETE'),
      ('autopost_job_logs','INSERT'),
      ('autopost_job_logs','UPDATE'),
      ('autopost_jobs','DELETE'),
      ('autopost_jobs','INSERT'),
      ('autopost_jobs','UPDATE'),
      ('autopost_rules','DELETE'),
      ('creator_platform_accounts','DELETE'),
      ('creator_platform_accounts','INSERT'),
      ('creator_platform_accounts','UPDATE'),
      ('creator_publishing_ai_twin_consents','DELETE'),
      ('creator_publishing_ai_twin_consents','INSERT'),
      ('creator_publishing_ai_twin_consents','UPDATE'),
      ('creator_publishing_audit_events','DELETE'),
      ('creator_publishing_audit_events','INSERT'),
      ('creator_publishing_audit_events','UPDATE'),
      ('creator_publishing_co_performer_records','DELETE'),
      ('creator_publishing_co_performer_records','INSERT'),
      ('creator_publishing_co_performer_records','UPDATE'),
      ('creator_publishing_compliance_reviews','DELETE'),
      ('creator_publishing_compliance_reviews','INSERT'),
      ('creator_publishing_compliance_reviews','UPDATE'),
      ('creator_publishing_content_packages','DELETE'),
      ('creator_publishing_content_packages','INSERT'),
      ('creator_publishing_content_packages','UPDATE'),
      ('creator_publishing_creator_verifications','DELETE'),
      ('creator_publishing_creator_verifications','INSERT'),
      ('creator_publishing_creator_verifications','UPDATE'),
      ('creator_publishing_media_assets','DELETE'),
      ('creator_publishing_media_assets','INSERT'),
      ('creator_publishing_media_assets','UPDATE'),
      ('creator_publishing_media_upload_intents','DELETE'),
      ('creator_publishing_media_upload_intents','INSERT'),
      ('creator_publishing_media_upload_intents','SELECT'),
      ('creator_publishing_media_upload_intents','UPDATE'),
      ('creator_publishing_plans','DELETE'),
      ('creator_publishing_plans','INSERT'),
      ('creator_publishing_plans','UPDATE'),
      ('creator_publishing_platform_jobs','DELETE'),
      ('creator_publishing_platform_jobs','INSERT'),
      ('creator_publishing_platform_jobs','UPDATE'),
      ('creator_publishing_queue_tasks','DELETE'),
      ('creator_publishing_queue_tasks','INSERT'),
      ('creator_publishing_queue_tasks','UPDATE'),
      ('creator_publishing_trusted_reviewers','DELETE'),
      ('creator_publishing_trusted_reviewers','INSERT'),
      ('creator_publishing_trusted_reviewers','SELECT'),
      ('creator_publishing_trusted_reviewers','UPDATE'),
      ('crypto_payments','DELETE'),
      ('crypto_payments','INSERT'),
      ('crypto_payments','UPDATE'),
      ('crypto_wallet_addresses','DELETE'),
      ('subscription_history','DELETE'),
      ('subscription_history','INSERT'),
      ('subscription_history','UPDATE'),
      ('subscription_tiers','DELETE'),
      ('subscription_tiers','INSERT'),
      ('subscription_tiers','UPDATE'),
      ('user_loras','DELETE'),
      ('user_subscriptions','DELETE'),
      ('user_subscriptions','INSERT'),
      ('user_subscriptions','UPDATE'),
      ('creator_publishing_fanvue_attempts','SELECT')) expected(rel,priv) cross join (values ('anon'),('authenticated')) role_name(role) where not (expected.rel='creator_publishing_fanvue_attempts' and role_name.role='authenticated') and (to_regclass('public.'||expected.rel) is null or not has_table_privilege(role_name.role,'public.'||expected.rel,expected.priv))) then raise exception 'FINAL_LP_STALE_GRANT_DRIFT'; end if;
  if exists (select 1 from (values ('_backup_autopost_rules_before_content_payload_20250628_001'),
      ('ai_influencers'),
      ('approved_media'),
      ('autopost_job_logs'),
      ('autopost_jobs'),
      ('autopost_rules'),
      ('autopost_run_results'),
      ('autopost_runs'),
      ('autopost_settings'),
      ('campaign_links'),
      ('caption_templates'),
      ('collection_items'),
      ('collections'),
      ('content_generation_jobs'),
      ('content_post_media'),
      ('content_post_targets'),
      ('content_posts'),
      ('content_posts_legacy_ai_influencer'),
      ('content_usage_log'),
      ('creator_platform_accounts'),
      ('creator_publishing_ai_twin_consents'),
      ('creator_publishing_audit_events'),
      ('creator_publishing_co_performer_records'),
      ('creator_publishing_compliance_reviews'),
      ('creator_publishing_content_packages'),
      ('creator_publishing_creator_verifications'),
      ('creator_publishing_media_assets'),
      ('creator_publishing_media_upload_intents'),
      ('creator_publishing_plans'),
      ('creator_publishing_platform_jobs'),
      ('creator_publishing_queue_tasks'),
      ('creator_publishing_trusted_reviewers'),
      ('crypto_payments'),
      ('crypto_wallet_addresses'),
      ('cta_variants'),
      ('dataset_doctor_images'),
      ('dataset_doctor_jobs'),
      ('dataset_doctor_selections'),
      ('generations'),
      ('hashtag_sets'),
      ('lora_status_events'),
      ('model_enrollments'),
      ('models'),
      ('platform_connections'),
      ('post_logs'),
      ('posting_rules'),
      ('purchases'),
      ('scheduled_posts'),
      ('sf_users'),
      ('subscription_history'),
      ('subscription_tiers'),
      ('system_stats'),
      ('user_loras'),
      ('user_subscriptions'),
      ('webhook_logs')) expected(rel) cross join (values ('anon'),('authenticated')) role_name(role) cross join (values ('TRUNCATE'),('TRIGGER'),('REFERENCES'),('MAINTAIN')) privilege(priv) where to_regclass('public.'||expected.rel) is null or not has_table_privilege(role_name.role,'public.'||expected.rel,privilege.priv)) then raise exception 'FINAL_LP_NON_DATA_API_DRIFT'; end if;
  if exists (select 1 from (values ('autopost_accounts'),('creator_publishing_fanvue_attempts')) expected(rel) cross join (values ('anon'),('authenticated')) role_name(role) where to_regclass('public.'||expected.rel) is null or not has_table_privilege(role_name.role,'public.'||expected.rel,'MAINTAIN')) then raise exception 'FINAL_LP_MAINTAIN_DRIFT'; end if;
  if exists (select 1 from (values ('autopost_accounts_preserve_fanvue_provider_identity()'),
      ('creator_publishing_aggregate_plan_status(uuid)'),
      ('creator_publishing_autopost_source_fingerprint(uuid)'),
      ('creator_publishing_job_source_is_current(uuid)'),
      ('creator_publishing_scheduler_validate_timezone(text)')) expected(sig) where to_regprocedure('public.'||sig) is null or not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=to_regprocedure('public.'||sig) and a.grantee=0 and a.privilege_type='EXECUTE') or not has_function_privilege('anon','public.'||sig,'EXECUTE') or not has_function_privilege('authenticated','public.'||sig,'EXECUTE') or not has_function_privilege('service_role','public.'||sig,'EXECUTE') or not has_function_privilege('postgres','public.'||sig,'EXECUTE')) then raise exception 'FINAL_LP_FUNCTION_DRIFT'; end if;
  if to_regprocedure('public.get_my_affiliate_ledger_summary()') is null then raise exception 'FINAL_LP_AFFILIATE_RPC_DRIFT'; end if;
  if to_regclass('public.creator_publishing_fanvue_history') is null or not has_table_privilege('anon','public.creator_publishing_fanvue_history','SELECT') or not has_table_privilege('authenticated','public.creator_publishing_fanvue_history','SELECT') or not has_table_privilege('service_role','public.creator_publishing_fanvue_history','SELECT') then raise exception 'FINAL_LP_FANVUE_VIEW_DRIFT'; end if;
  if exists (select 1 from (values ('autopost_job_logs_id_seq'),
      ('creator_publishing_audit_events_id_seq'),
      ('purchases_id_seq')) expected(rel) cross join (values ('anon'),('authenticated'),('service_role')) role_name(role) cross join (values ('USAGE'),('SELECT'),('UPDATE')) privilege(priv) where to_regclass('public.'||expected.rel) is null or not has_sequence_privilege(role_name.role,'public.'||expected.rel,privilege.priv)) then raise exception 'FINAL_LP_SEQUENCE_DRIFT'; end if;
  select count(*) <> 10 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a join pg_roles r on r.oid=a.grantee where d.defaclrole='postgres'::regrole and d.defaclnamespace='public'::regnamespace and ((d.defaclobjtype='r' and r.rolname in ('anon','authenticated') and a.privilege_type in ('TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')) or (d.defaclobjtype='S' and r.rolname in ('anon','authenticated') and a.privilege_type='UPDATE')) into bad;
  if coalesce(bad,true) then raise exception 'FINAL_LP_DEFAULT_PRIVILEGE_DRIFT'; end if;
end $preflight$;

revoke DELETE, INSERT, SELECT, UPDATE on table public._backup_autopost_rules_before_content_payload_20250628_001 from anon, authenticated;
revoke DELETE, INSERT, UPDATE on table public.autopost_job_logs from anon, authenticated;
revoke DELETE, INSERT, UPDATE on table public.autopost_jobs from anon, authenticated;
revoke DELETE on table public.autopost_rules from anon, authenticated;
revoke DELETE, INSERT, UPDATE on table public.creator_platform_accounts from anon, authenticated;
revoke DELETE, INSERT, UPDATE on table public.creator_publishing_ai_twin_consents from anon, authenticated;
revoke DELETE, INSERT, UPDATE on table public.creator_publishing_audit_events from anon, authenticated;
revoke DELETE, INSERT, UPDATE on table public.creator_publishing_co_performer_records from anon, authenticated;
revoke DELETE, INSERT, UPDATE on table public.creator_publishing_compliance_reviews from anon, authenticated;
revoke DELETE, INSERT, UPDATE on table public.creator_publishing_content_packages from anon, authenticated;
revoke DELETE, INSERT, UPDATE on table public.creator_publishing_creator_verifications from anon, authenticated;
revoke DELETE, INSERT, UPDATE on table public.creator_publishing_media_assets from anon, authenticated;
revoke DELETE, INSERT, SELECT, UPDATE on table public.creator_publishing_media_upload_intents from anon, authenticated;
revoke DELETE, INSERT, UPDATE on table public.creator_publishing_plans from anon, authenticated;
revoke DELETE, INSERT, UPDATE on table public.creator_publishing_platform_jobs from anon, authenticated;
revoke DELETE, INSERT, UPDATE on table public.creator_publishing_queue_tasks from anon, authenticated;
revoke DELETE, INSERT, SELECT, UPDATE on table public.creator_publishing_trusted_reviewers from anon, authenticated;
revoke DELETE, INSERT, UPDATE on table public.crypto_payments from anon, authenticated;
revoke DELETE on table public.crypto_wallet_addresses from anon, authenticated;
revoke DELETE, INSERT, UPDATE on table public.subscription_history from anon, authenticated;
revoke DELETE, INSERT, UPDATE on table public.subscription_tiers from anon, authenticated;
revoke DELETE on table public.user_loras from anon, authenticated;
revoke DELETE, INSERT, UPDATE on table public.user_subscriptions from anon, authenticated;
revoke select on table public.creator_publishing_fanvue_attempts from anon;
revoke truncate, trigger, references, maintain on table public._backup_autopost_rules_before_content_payload_20250628_001 from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.ai_influencers from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.approved_media from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.autopost_job_logs from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.autopost_jobs from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.autopost_rules from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.autopost_run_results from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.autopost_runs from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.autopost_settings from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.campaign_links from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.caption_templates from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.collection_items from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.collections from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.content_generation_jobs from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.content_post_media from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.content_post_targets from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.content_posts from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.content_posts_legacy_ai_influencer from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.content_usage_log from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.creator_platform_accounts from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.creator_publishing_ai_twin_consents from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.creator_publishing_audit_events from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.creator_publishing_co_performer_records from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.creator_publishing_compliance_reviews from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.creator_publishing_content_packages from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.creator_publishing_creator_verifications from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.creator_publishing_media_assets from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.creator_publishing_media_upload_intents from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.creator_publishing_plans from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.creator_publishing_platform_jobs from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.creator_publishing_queue_tasks from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.creator_publishing_trusted_reviewers from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.crypto_payments from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.crypto_wallet_addresses from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.cta_variants from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.dataset_doctor_images from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.dataset_doctor_jobs from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.dataset_doctor_selections from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.generations from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.hashtag_sets from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.lora_status_events from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.model_enrollments from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.models from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.platform_connections from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.post_logs from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.posting_rules from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.purchases from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.scheduled_posts from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.sf_users from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.subscription_history from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.subscription_tiers from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.system_stats from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.user_loras from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.user_subscriptions from anon, authenticated;
revoke truncate, trigger, references, maintain on table public.webhook_logs from anon, authenticated;
revoke maintain on table public.autopost_accounts from anon, authenticated;
revoke maintain on table public.creator_publishing_fanvue_attempts from anon, authenticated;
revoke execute on function public.autopost_accounts_preserve_fanvue_provider_identity() from public, anon, authenticated;
revoke execute on function public.creator_publishing_aggregate_plan_status(uuid) from public, anon, authenticated;
revoke execute on function public.creator_publishing_autopost_source_fingerprint(uuid) from public, anon, authenticated;
revoke execute on function public.creator_publishing_job_source_is_current(uuid) from public, anon, authenticated;
revoke execute on function public.creator_publishing_scheduler_validate_timezone(text) from public, anon, authenticated;
revoke all privileges on table public.creator_publishing_fanvue_history from anon, authenticated;
revoke usage, select, update on sequence public.autopost_job_logs_id_seq from anon, authenticated;
revoke usage, select, update on sequence public.creator_publishing_audit_events_id_seq from anon, authenticated;
revoke usage, select, update on sequence public.purchases_id_seq from anon, authenticated;
alter default privileges for role postgres in schema public revoke truncate, trigger, references, maintain on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke update on sequences from anon, authenticated;

do $postcondition$
begin
  if exists (select 1 from (values ('_backup_autopost_rules_before_content_payload_20250628_001','DELETE'),
      ('_backup_autopost_rules_before_content_payload_20250628_001','INSERT'),
      ('_backup_autopost_rules_before_content_payload_20250628_001','SELECT'),
      ('_backup_autopost_rules_before_content_payload_20250628_001','UPDATE'),
      ('autopost_job_logs','DELETE'),
      ('autopost_job_logs','INSERT'),
      ('autopost_job_logs','UPDATE'),
      ('autopost_jobs','DELETE'),
      ('autopost_jobs','INSERT'),
      ('autopost_jobs','UPDATE'),
      ('autopost_rules','DELETE'),
      ('creator_platform_accounts','DELETE'),
      ('creator_platform_accounts','INSERT'),
      ('creator_platform_accounts','UPDATE'),
      ('creator_publishing_ai_twin_consents','DELETE'),
      ('creator_publishing_ai_twin_consents','INSERT'),
      ('creator_publishing_ai_twin_consents','UPDATE'),
      ('creator_publishing_audit_events','DELETE'),
      ('creator_publishing_audit_events','INSERT'),
      ('creator_publishing_audit_events','UPDATE'),
      ('creator_publishing_co_performer_records','DELETE'),
      ('creator_publishing_co_performer_records','INSERT'),
      ('creator_publishing_co_performer_records','UPDATE'),
      ('creator_publishing_compliance_reviews','DELETE'),
      ('creator_publishing_compliance_reviews','INSERT'),
      ('creator_publishing_compliance_reviews','UPDATE'),
      ('creator_publishing_content_packages','DELETE'),
      ('creator_publishing_content_packages','INSERT'),
      ('creator_publishing_content_packages','UPDATE'),
      ('creator_publishing_creator_verifications','DELETE'),
      ('creator_publishing_creator_verifications','INSERT'),
      ('creator_publishing_creator_verifications','UPDATE'),
      ('creator_publishing_media_assets','DELETE'),
      ('creator_publishing_media_assets','INSERT'),
      ('creator_publishing_media_assets','UPDATE'),
      ('creator_publishing_media_upload_intents','DELETE'),
      ('creator_publishing_media_upload_intents','INSERT'),
      ('creator_publishing_media_upload_intents','SELECT'),
      ('creator_publishing_media_upload_intents','UPDATE'),
      ('creator_publishing_plans','DELETE'),
      ('creator_publishing_plans','INSERT'),
      ('creator_publishing_plans','UPDATE'),
      ('creator_publishing_platform_jobs','DELETE'),
      ('creator_publishing_platform_jobs','INSERT'),
      ('creator_publishing_platform_jobs','UPDATE'),
      ('creator_publishing_queue_tasks','DELETE'),
      ('creator_publishing_queue_tasks','INSERT'),
      ('creator_publishing_queue_tasks','UPDATE'),
      ('creator_publishing_trusted_reviewers','DELETE'),
      ('creator_publishing_trusted_reviewers','INSERT'),
      ('creator_publishing_trusted_reviewers','SELECT'),
      ('creator_publishing_trusted_reviewers','UPDATE'),
      ('crypto_payments','DELETE'),
      ('crypto_payments','INSERT'),
      ('crypto_payments','UPDATE'),
      ('crypto_wallet_addresses','DELETE'),
      ('subscription_history','DELETE'),
      ('subscription_history','INSERT'),
      ('subscription_history','UPDATE'),
      ('subscription_tiers','DELETE'),
      ('subscription_tiers','INSERT'),
      ('subscription_tiers','UPDATE'),
      ('user_loras','DELETE'),
      ('user_subscriptions','DELETE'),
      ('user_subscriptions','INSERT'),
      ('user_subscriptions','UPDATE'),
      ('creator_publishing_fanvue_attempts','SELECT')) expected(rel,priv) cross join (values ('anon'),('authenticated')) role_name(role) where not (expected.rel='creator_publishing_fanvue_attempts' and role_name.role='authenticated') and has_table_privilege(role_name.role,'public.'||expected.rel,expected.priv)) then raise exception 'FINAL_LP_STALE_POSTCONDITION_FAILED'; end if;
  if exists (select 1 from (values ('_backup_autopost_rules_before_content_payload_20250628_001'),
      ('ai_influencers'),
      ('approved_media'),
      ('autopost_job_logs'),
      ('autopost_jobs'),
      ('autopost_rules'),
      ('autopost_run_results'),
      ('autopost_runs'),
      ('autopost_settings'),
      ('campaign_links'),
      ('caption_templates'),
      ('collection_items'),
      ('collections'),
      ('content_generation_jobs'),
      ('content_post_media'),
      ('content_post_targets'),
      ('content_posts'),
      ('content_posts_legacy_ai_influencer'),
      ('content_usage_log'),
      ('creator_platform_accounts'),
      ('creator_publishing_ai_twin_consents'),
      ('creator_publishing_audit_events'),
      ('creator_publishing_co_performer_records'),
      ('creator_publishing_compliance_reviews'),
      ('creator_publishing_content_packages'),
      ('creator_publishing_creator_verifications'),
      ('creator_publishing_media_assets'),
      ('creator_publishing_media_upload_intents'),
      ('creator_publishing_plans'),
      ('creator_publishing_platform_jobs'),
      ('creator_publishing_queue_tasks'),
      ('creator_publishing_trusted_reviewers'),
      ('crypto_payments'),
      ('crypto_wallet_addresses'),
      ('cta_variants'),
      ('dataset_doctor_images'),
      ('dataset_doctor_jobs'),
      ('dataset_doctor_selections'),
      ('generations'),
      ('hashtag_sets'),
      ('lora_status_events'),
      ('model_enrollments'),
      ('models'),
      ('platform_connections'),
      ('post_logs'),
      ('posting_rules'),
      ('purchases'),
      ('scheduled_posts'),
      ('sf_users'),
      ('subscription_history'),
      ('subscription_tiers'),
      ('system_stats'),
      ('user_loras'),
      ('user_subscriptions'),
      ('webhook_logs')) expected(rel) cross join (values ('anon'),('authenticated')) role_name(role) cross join (values ('TRUNCATE'),('TRIGGER'),('REFERENCES'),('MAINTAIN')) privilege(priv) where has_table_privilege(role_name.role,'public.'||expected.rel,privilege.priv)) then raise exception 'FINAL_LP_NON_DATA_API_POSTCONDITION_FAILED'; end if;
  if exists (select 1 from (values ('autopost_accounts_preserve_fanvue_provider_identity()'),
      ('creator_publishing_aggregate_plan_status(uuid)'),
      ('creator_publishing_autopost_source_fingerprint(uuid)'),
      ('creator_publishing_job_source_is_current(uuid)'),
      ('creator_publishing_scheduler_validate_timezone(text)')) expected(sig) where exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=to_regprocedure('public.'||sig) and a.grantee=0 and a.privilege_type='EXECUTE') or has_function_privilege('anon','public.'||sig,'EXECUTE') or has_function_privilege('authenticated','public.'||sig,'EXECUTE') or not has_function_privilege('service_role','public.'||sig,'EXECUTE') or not has_function_privilege('postgres','public.'||sig,'EXECUTE')) then raise exception 'FINAL_LP_FUNCTION_POSTCONDITION_FAILED'; end if;
  if has_table_privilege('anon','public.creator_publishing_fanvue_history','SELECT') or has_table_privilege('authenticated','public.creator_publishing_fanvue_history','SELECT') or not has_table_privilege('service_role','public.creator_publishing_fanvue_history','SELECT') then raise exception 'FINAL_LP_VIEW_POSTCONDITION_FAILED'; end if;
  if exists (select 1 from (values ('autopost_job_logs_id_seq'),
      ('creator_publishing_audit_events_id_seq'),
      ('purchases_id_seq')) expected(rel) cross join (values ('anon'),('authenticated')) role_name(role) cross join (values ('USAGE'),('SELECT'),('UPDATE')) privilege(priv) where has_sequence_privilege(role_name.role,'public.'||expected.rel,privilege.priv)) or exists (select 1 from (values ('autopost_job_logs_id_seq'),
      ('creator_publishing_audit_events_id_seq'),
      ('purchases_id_seq')) expected(rel) cross join (values ('USAGE'),('SELECT'),('UPDATE')) privilege(priv) where not has_sequence_privilege('service_role','public.'||expected.rel,privilege.priv)) then raise exception 'FINAL_LP_SEQUENCE_POSTCONDITION_FAILED'; end if;
  if exists(select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a join pg_roles r on r.oid=a.grantee where d.defaclrole='postgres'::regrole and d.defaclnamespace='public'::regnamespace and ((d.defaclobjtype='r' and r.rolname in ('anon','authenticated') and a.privilege_type in ('TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')) or (d.defaclobjtype='S' and r.rolname in ('anon','authenticated') and a.privilege_type='UPDATE'))) then raise exception 'FINAL_LP_DEFAULT_POSTCONDITION_FAILED'; end if;
end $postcondition$;

commit;
