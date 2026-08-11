BEGIN;
DO $$ BEGIN
 IF current_user<>'postgres' OR to_regclass('public.profiles') IS NULL OR to_regclass('public.token_packs') IS NULL OR to_regclass('public.token_transactions') IS NULL
 OR to_regclass('lock05c_backup_20260811_pre_apply.manifest') IS NOT NULL
 THEN RAISE EXCEPTION 'LOCK05C_DRIFT: backup prestate or operator mismatch'; END IF;
END $$;
CREATE SCHEMA lock05c_backup_20260811_pre_apply AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA lock05c_backup_20260811_pre_apply FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE lock05c_backup_20260811_pre_apply.manifest(key text PRIMARY KEY,value text NOT NULL);
INSERT INTO lock05c_backup_20260811_pre_apply.manifest VALUES
 ('baseline_sha','3b3075c903f292c10dbe8423f85fe4702f6e30c7'),('migration','20260811070000_lock05c_permanent_token_retirement.sql'),('created_at',clock_timestamp()::text);
CREATE TABLE lock05c_backup_20260811_pre_apply.token_packs (LIKE public.token_packs INCLUDING ALL);
INSERT INTO lock05c_backup_20260811_pre_apply.token_packs SELECT * FROM public.token_packs;
CREATE TABLE lock05c_backup_20260811_pre_apply.token_transactions (LIKE public.token_transactions INCLUDING ALL);
INSERT INTO lock05c_backup_20260811_pre_apply.token_transactions SELECT * FROM public.token_transactions;
CREATE TABLE lock05c_backup_20260811_pre_apply.profile_state AS SELECT id,user_id,tier,tokens FROM public.profiles;
CREATE TABLE lock05c_backup_20260811_pre_apply.generations_tokens AS SELECT id,tokens_cost FROM public.generations;
CREATE TABLE lock05c_backup_20260811_pre_apply.purchases_tokens AS SELECT id,tokens_received FROM public.purchases;
CREATE TABLE lock05c_backup_20260811_pre_apply.referrals_tokens AS SELECT id,reward_tokens FROM public.referrals;
CREATE TABLE lock05c_backup_20260811_pre_apply.system_stats_tokens AS SELECT ctid::text row_locator,tokens_purchased,tokens_spent FROM public.system_stats;
CREATE TABLE lock05c_backup_20260811_pre_apply.crypto_payment_tokens AS SELECT id,token_pack_id FROM public.crypto_payments;
CREATE TABLE lock05c_backup_20260811_pre_apply.column_types AS
 SELECT c.relname table_name,a.attname column_name,format_type(a.atttypid,a.atttypmod) data_type,a.attnotnull
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
 WHERE n.nspname='public' AND NOT a.attisdropped AND (c.relname,a.attname) IN (('profiles','tokens'),('generations','tokens_cost'),('purchases','tokens_received'),('referrals','reward_tokens'),('system_stats','tokens_purchased'),('system_stats','tokens_spent'),('crypto_payments','token_pack_id'));
CREATE TABLE lock05c_backup_20260811_pre_apply.column_defaults AS
 SELECT c.relname table_name,a.attname column_name,pg_get_expr(d.adbin,d.adrelid) default_expression
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname='public' AND (c.relname,a.attname) IN (('profiles','tier'),('profiles','tokens'),('purchases','purchase_type'));
CREATE TABLE lock05c_backup_20260811_pre_apply.constraints AS
 SELECT conrelid::regclass::text table_name,conname,pg_get_constraintdef(oid) definition FROM pg_constraint
 WHERE (conrelid='public.profiles'::regclass AND conname='check_tier_valid') OR (conrelid='public.crypto_payments'::regclass AND conname='crypto_payments_token_pack_id_fkey');
CREATE TABLE lock05c_backup_20260811_pre_apply.functions AS
 SELECT p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition,p.prosecdef,p.proconfig,p.proacl::text acl,r.rolname owner
 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid IN
 ('public.handle_new_user()'::regprocedure,'public.initialize_new_user()'::regprocedure,'public.add_tokens(uuid,integer,text)'::regprocedure,'public.deduct_tokens(uuid,integer)'::regprocedure,'public.deduct_tokens(uuid,integer,text)'::regprocedure,'public.complete_referral_reward(uuid)'::regprocedure,'public.get_user_stats(uuid)'::regprocedure);
CREATE TABLE lock05c_backup_20260811_pre_apply.function_grants AS
 SELECT p.oid::regprocedure::text identity,coalesce(grantee.rolname,'PUBLIC') grantee,x.privilege_type,x.is_grantable
 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x LEFT JOIN pg_roles grantee ON grantee.oid=x.grantee
 WHERE p.oid IN ('public.handle_new_user()'::regprocedure,'public.initialize_new_user()'::regprocedure,'public.add_tokens(uuid,integer,text)'::regprocedure,'public.deduct_tokens(uuid,integer)'::regprocedure,'public.deduct_tokens(uuid,integer,text)'::regprocedure,'public.complete_referral_reward(uuid)'::regprocedure,'public.get_user_stats(uuid)'::regprocedure);
CREATE TABLE lock05c_backup_20260811_pre_apply.triggers AS
 SELECT c.oid::regclass::text table_name,t.tgname,pg_get_triggerdef(t.oid,true) definition,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 WHERE NOT t.tgisinternal AND ((t.tgname='on_auth_user_created' AND t.tgrelid='auth.users'::regclass) OR (t.tgname='on_profile_created' AND t.tgrelid='public.profiles'::regclass));
CREATE TABLE lock05c_backup_20260811_pre_apply.table_security AS
 SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text acl,r.rolname owner FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner
 WHERE c.oid IN ('public.profiles'::regclass,'public.token_packs'::regclass,'public.token_transactions'::regclass);
CREATE TABLE lock05c_backup_20260811_pre_apply.policies AS
SELECT
 c.relname AS table_name,
 p.polname AS policy_name,
 p.polpermissive AS is_permissive,
 p.polcmd AS command,
 ARRAY(
   SELECT CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE r.rolname END
   FROM unnest(p.polroles) AS role_oid
   LEFT JOIN pg_roles r ON r.oid = role_oid
   ORDER BY CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE r.rolname END
 )::text[] AS role_names,
 pg_get_expr(p.polqual,p.polrelid) AS using_expression,
 pg_get_expr(p.polwithcheck,p.polrelid) AS with_check_expression
FROM pg_policy p
JOIN pg_class c ON c.oid=p.polrelid
WHERE p.polrelid IN ('public.profiles'::regclass,'public.token_packs'::regclass,'public.token_transactions'::regclass)
ORDER BY c.relname,p.polname;
CREATE TABLE lock05c_backup_20260811_pre_apply.profile_column_grants AS SELECT column_name,grantee,privilege_type,is_grantable FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='profiles';
CREATE TABLE lock05c_backup_20260811_pre_apply.grants AS SELECT table_name,grantee,privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN ('token_packs','token_transactions');
CREATE TABLE lock05c_backup_20260811_pre_apply.counts AS SELECT 'profiles' source,count(*) rows FROM public.profiles UNION ALL SELECT 'token_packs',count(*) FROM public.token_packs UNION ALL SELECT 'token_transactions',count(*) FROM public.token_transactions;
REVOKE ALL ON ALL TABLES IN SCHEMA lock05c_backup_20260811_pre_apply FROM PUBLIC,anon,authenticated,service_role;
DO $$ BEGIN
 IF (SELECT count(*) FROM lock05c_backup_20260811_pre_apply.token_packs)<>3 OR (SELECT count(*) FROM lock05c_backup_20260811_pre_apply.token_transactions)<>0
 OR (SELECT count(*) FROM lock05c_backup_20260811_pre_apply.functions)<>7 OR (SELECT count(*) FROM lock05c_backup_20260811_pre_apply.triggers)<>2
 OR EXISTS(SELECT FROM lock05c_backup_20260811_pre_apply.policies WHERE role_names IS NULL OR cardinality(role_names)=0 OR command NOT IN ('r','a','w','d','*'))
 OR EXISTS(SELECT FROM information_schema.columns WHERE table_schema='lock05c_backup_20260811_pre_apply' AND column_name='password_hash')
 OR has_schema_privilege('anon','lock05c_backup_20260811_pre_apply','USAGE') OR has_schema_privilege('authenticated','lock05c_backup_20260811_pre_apply','USAGE') OR has_schema_privilege('service_role','lock05c_backup_20260811_pre_apply','USAGE')
 THEN RAISE EXCEPTION 'LOCK05C_POSTCONDITION_FAILED: private backup'; END IF;
END $$;
COMMIT;
