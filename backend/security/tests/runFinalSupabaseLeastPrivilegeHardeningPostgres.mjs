import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const databaseUrl=process.env.FINAL_SUPABASE_LEAST_PRIVILEGE_DATABASE_URL;
if(!databaseUrl)throw new Error('FINAL_SUPABASE_LEAST_PRIVILEGE_DATABASE_URL is required; no database was contacted');
const url=new URL(databaseUrl);
if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.port!=='5432'||url.pathname!=='/final_supabase_least_privilege_test'||url.search||url.hash)throw new Error('Safety boundary rejected remote, non-local, or incorrectly named database URL');
const migration=readFileSync('supabase/migrations/20260821040658_final_supabase_least_privilege_hardening.sql','utf8');
const rollback=readFileSync('supabase/manual/final_supabase_least_privilege_hardening_rollback.sql','utf8');
function psql(sql,ok=true){const r=spawnSync('psql',[databaseUrl,'-X','-v','ON_ERROR_STOP=1','-qAt'],{input:sql,encoding:'utf8'});if((r.status===0)!==ok)throw new Error(`psql expectation failed\nstdout=${r.stdout}\nstderr=${r.stderr}`);return r.stdout.trim()}
const tables=`_backup_autopost_rules_before_content_payload_20250628_001 ai_influencers approved_media autopost_job_logs autopost_jobs autopost_rules autopost_run_results autopost_runs autopost_settings campaign_links caption_templates collection_items collections content_generation_jobs content_post_media content_post_targets content_posts content_posts_legacy_ai_influencer content_usage_log creator_platform_accounts creator_publishing_ai_twin_consents creator_publishing_audit_events creator_publishing_co_performer_records creator_publishing_compliance_reviews creator_publishing_content_packages creator_publishing_creator_verifications creator_publishing_media_assets creator_publishing_media_upload_intents creator_publishing_plans creator_publishing_platform_jobs creator_publishing_queue_tasks creator_publishing_trusted_reviewers crypto_payments crypto_wallet_addresses cta_variants dataset_doctor_images dataset_doctor_jobs dataset_doctor_selections generations hashtag_sets lora_status_events model_enrollments models platform_connections post_logs posting_rules purchases scheduled_posts sf_users subscription_history subscription_tiers system_stats user_loras user_subscriptions webhook_logs autopost_accounts creator_publishing_fanvue_attempts`.split(' ');
const helpers=[['autopost_accounts_preserve_fanvue_provider_identity',''],['creator_publishing_aggregate_plan_status','uuid'],['creator_publishing_autopost_source_fingerprint','uuid'],['creator_publishing_job_source_is_current','uuid'],['creator_publishing_scheduler_validate_timezone','text']];
const seqs=['autopost_job_logs_id_seq','creator_publishing_audit_events_id_seq','purchases_id_seq'];
const fixture=`drop schema if exists public cascade;create schema public authorization postgres;
do $$begin if not exists(select from pg_roles where rolname='anon')then create role anon nologin;end if;if not exists(select from pg_roles where rolname='authenticated')then create role authenticated nologin;end if;if not exists(select from pg_roles where rolname='service_role')then create role service_role nologin bypassrls;end if;if not exists(select from pg_roles where rolname='supabase_admin')then create role supabase_admin nologin;end if;end$$;
grant usage on schema public to anon,authenticated,service_role;
${tables.map(t=>`create table public.${t}(id bigint);alter table public.${t} enable row level security;create policy fixture_policy on public.${t} for select to authenticated using(true);grant all privileges on table public.${t} to anon,authenticated,service_role;`).join('\n')}
create view public.creator_publishing_fanvue_history as select id from public.creator_publishing_fanvue_attempts;grant select on public.creator_publishing_fanvue_history to anon,authenticated,service_role;
${seqs.map(s=>`create sequence public.${s};grant usage,select,update on sequence public.${s} to anon,authenticated,service_role;`).join('\n')}
${helpers.map(([n,a])=>`create function public.${n}(${a})returns boolean language sql stable as $$select true$$;revoke all on function public.${n}(${a}) from public,postgres,anon,authenticated,service_role;grant execute on function public.${n}(${a}) to public,postgres,anon,authenticated,service_role;`).join('\n')}
create function public.get_my_affiliate_ledger_summary()returns integer language sql security definer as $$select 1$$;revoke all on function public.get_my_affiliate_ledger_summary()from public,anon,authenticated,service_role;grant execute on function public.get_my_affiliate_ledger_summary()to authenticated,service_role;
alter default privileges for role postgres in schema public grant all privileges on tables to anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant all privileges on sequences to anon,authenticated,service_role;
alter default privileges for role supabase_admin in schema public grant select on tables to anon;
`;
psql(fixture);
const snapshot=()=>psql(`select md5(string_agg(x,'|' order by x))from(select 'r:'||c.relname||':'||coalesce(c.relacl::text,'NULL') x from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' union all select 'p:'||p.oid::regprocedure::text||':'||coalesce(p.proacl::text,'NULL') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' union all select 'd:'||d.defaclrole||':'||d.defaclnamespace||':'||d.defaclobjtype::text||':'||d.defaclacl::text from pg_default_acl d where d.defaclrole in('postgres'::regrole,'supabase_admin'::regrole))s`);
const before=snapshot();
const affiliate=psql(`select proacl::text||':'||md5(prosrc) from pg_proc where oid='public.get_my_affiliate_ledger_summary()'::regprocedure`);
const policyCount=psql(`select count(*)from pg_policy where polrelid in(select oid from pg_class where relnamespace='public'::regnamespace)`);
const adminDefaults=psql(`select defaclacl::text from pg_default_acl where defaclrole='supabase_admin'::regrole and defaclnamespace='public'::regnamespace and defaclobjtype='r'`);
psql(migration);
if(psql(`select count(*)from information_schema.role_table_grants where table_schema='public' and grantee in('anon','authenticated') and privilege_type in('TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')`)!=='0')throw new Error('non-Data-API grants remain');
if(psql(`select count(*)from (values ${helpers.map(([n,a])=>`('public.${n}(${a})')`).join(',')})v(sig)where has_function_privilege('anon',sig,'EXECUTE')or has_function_privilege('authenticated',sig,'EXECUTE')or not has_function_privilege('service_role',sig,'EXECUTE')`)!=='0')throw new Error('helper boundary mismatch');
if(psql(`select has_table_privilege('anon','public.creator_publishing_fanvue_history','SELECT')||','||has_table_privilege('authenticated','public.creator_publishing_fanvue_history','SELECT')||','||has_table_privilege('service_role','public.creator_publishing_fanvue_history','SELECT')`)!=='false,false,true')throw new Error('Fanvue history ACL mismatch');
if(psql(`select count(*)from (values ${seqs.map(s=>`('${s}')`).join(',')})v(s)cross join(values('anon'),('authenticated'))r(role)cross join(values('USAGE'),('SELECT'),('UPDATE'))p(priv)where has_sequence_privilege(role,'public.'||s,priv)`)!=='0')throw new Error('sequence browser ACL remains');
if(psql(`select has_table_privilege('authenticated','public.ai_influencers','SELECT')||','||has_table_privilege('service_role','public.crypto_payments','UPDATE')`)!=='true,true')throw new Error('legitimate/service grants changed');
if(psql(`select proacl::text||':'||md5(prosrc) from pg_proc where oid='public.get_my_affiliate_ledger_summary()'::regprocedure`)!==affiliate)throw new Error('affiliate RPC changed');
if(psql(`select count(*)from pg_policy where polrelid in(select oid from pg_class where relnamespace='public'::regnamespace)`)!==policyCount)throw new Error('RLS architecture changed');
if(psql(`select defaclacl::text from pg_default_acl where defaclrole='supabase_admin'::regrole and defaclnamespace='public'::regnamespace and defaclobjtype='r'`)!==adminDefaults)throw new Error('supabase_admin defaults changed');
psql(rollback);
if(snapshot()!==before)throw new Error('rollback did not restore exact fixture ACL/default prestate');
console.log('Final Supabase least-privilege PostgreSQL 17 integration passed: ACLs, defaults, preserved boundaries, frozen architecture, and exact rollback');
