-- MANUAL ONLY. Review against Production read-only catalog evidence before execution.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

CREATE TEMP TABLE lock05f_targets ON COMMIT DROP AS
SELECT p.id AS profile_id,p.user_id AS auth_user_id,p.seat_number,p.og_seat_number
FROM public.profiles p JOIN auth.users u ON u.id=p.user_id
WHERE p.is_og_vip IS TRUE
  AND p.id <> '879c8a17-f9e8-473d-8de1-1fd1a77c080e'::uuid
  AND p.user_id <> '879c8a17-f9e8-473d-8de1-1fd1a77c080e'::uuid
  AND lower(u.email) <> 'admin@sirensforge.vip'
FOR UPDATE OF p,u;
CREATE TEMP TABLE lock05f_target_codes ON COMMIT DROP AS
 SELECT r.id FROM public.referral_codes r JOIN lock05f_targets t ON t.auth_user_id=r.user_id FOR UPDATE OF r;
CREATE TEMP TABLE lock05f_test_tracking ON COMMIT DROP AS
 SELECT r.id,r.referral_code_id,r.referrer_user_id,r.referred_user_id FROM public.referral_tracking r
 JOIN lock05f_targets t ON t.auth_user_id=r.referred_user_id FOR UPDATE OF r;
CREATE TEMP TABLE lock05f_test_commission ON COMMIT DROP AS
 SELECT c.id,c.referral_code_id,c.referrer_user_id,c.referred_user_id FROM public.commission_earnings c
 JOIN lock05f_targets t ON t.auth_user_id=c.referred_user_id FOR UPDATE OF c;

DO $guard$
DECLARE fk record; hit bigint;
BEGIN
 IF (SELECT count(*) FROM lock05f_targets)<>21 THEN RAISE EXCEPTION 'lock05f_expected_21_targets'; END IF;
 IF (SELECT array_agg(coalesce(seat_number,og_seat_number) ORDER BY coalesce(seat_number,og_seat_number)) FROM lock05f_targets)
      IS DISTINCT FROM ARRAY(SELECT generate_series(1,21))
 OR EXISTS(SELECT 1 FROM lock05f_targets WHERE seat_number IS DISTINCT FROM og_seat_number)
 THEN RAISE EXCEPTION 'lock05f_seat_population_mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.profiles p JOIN lock05f_targets t ON t.profile_id=p.id
   WHERE lower(p.email)='admin@sirensforge.vip' OR p.role='admin'
      OR p.id='879c8a17-f9e8-473d-8de1-1fd1a77c080e' OR p.user_id='879c8a17-f9e8-473d-8de1-1fd1a77c080e')
 THEN RAISE EXCEPTION 'lock05f_protected_admin_or_role_targeted'; END IF;
 IF (SELECT count(*) FROM auth.users WHERE id='879c8a17-f9e8-473d-8de1-1fd1a77c080e' AND lower(email)='admin@sirensforge.vip')<>1
 OR (SELECT count(*) FROM public.profiles WHERE id='879c8a17-f9e8-473d-8de1-1fd1a77c080e' AND user_id='879c8a17-f9e8-473d-8de1-1fd1a77c080e' AND lower(email)='admin@sirensforge.vip' AND is_og_vip IS FALSE AND seat_number IS NULL AND og_seat_number IS NULL)<>1
 THEN RAISE EXCEPTION 'lock05f_protected_admin_precondition'; END IF;
 IF (SELECT count(*) FROM public.user_subscriptions s WHERE s.tier_name='og_throne' AND NOT EXISTS(SELECT 1 FROM lock05f_targets t WHERE t.profile_id=s.user_id))<>1
 OR (SELECT count(*) FROM public.user_subscriptions WHERE tier_name='og_throne' AND user_id='879c8a17-f9e8-473d-8de1-1fd1a77c080e')<>1
 THEN RAISE EXCEPTION 'lock05f_protected_admin_subscription_precondition'; END IF;
 IF (SELECT count(*) FROM auth.users u JOIN lock05f_targets t ON t.auth_user_id=u.id)<>21 THEN RAISE EXCEPTION 'lock05f_auth_population_mismatch'; END IF;
 IF (SELECT count(*) FROM public.user_subscriptions s JOIN lock05f_targets t ON t.profile_id=s.user_id WHERE s.tier_name='og_throne')<>20
 OR EXISTS(SELECT 1 FROM public.user_subscriptions s JOIN lock05f_targets t ON t.profile_id=s.user_id WHERE s.tier_name<>'og_throne')
 THEN RAISE EXCEPTION 'lock05f_subscription_population_mismatch'; END IF;
 IF (SELECT count(*) FROM lock05f_target_codes)<>21 THEN RAISE EXCEPTION 'lock05f_expected_21_referral_codes'; END IF;
 IF EXISTS(SELECT 1 FROM public.referral_codes r JOIN lock05f_target_codes x ON x.id=r.id WHERE r.total_uses IS DISTINCT FROM 0)
 THEN RAISE EXCEPTION 'lock05f_stale_referral_code_used'; END IF;
 IF (SELECT count(*) FROM lock05f_test_tracking)<>1
 OR NOT EXISTS(SELECT 1 FROM lock05f_test_tracking r JOIN lock05f_targets t ON t.auth_user_id=r.referred_user_id WHERE t.seat_number=1)
 THEN RAISE EXCEPTION 'lock05f_tracking_contract_mismatch'; END IF;
 IF (SELECT count(*) FROM lock05f_test_commission)<>1
 OR NOT EXISTS(SELECT 1 FROM public.commission_earnings c JOIN lock05f_test_commission x ON x.id=c.id JOIN lock05f_targets t ON t.auth_user_id=c.referred_user_id
   WHERE t.seat_number=1 AND c.transaction_reference='TEST_TXN_001' AND c.status='pending' AND c.paid_at IS NULL
     AND c.commission_type='subscription' AND c.base_amount=100 AND c.commission_rate=10 AND c.commission_amount=10 AND c.metadata='{}'::jsonb)
 THEN RAISE EXCEPTION 'lock05f_commission_contract_mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM lock05f_test_tracking r JOIN lock05f_test_commission c USING(referral_code_id)
   WHERE r.referred_user_id=c.referred_user_id AND r.referrer_user_id=c.referrer_user_id
     AND NOT EXISTS(SELECT 1 FROM lock05f_targets t WHERE t.auth_user_id=r.referrer_user_id)
     AND NOT EXISTS(SELECT 1 FROM public.referral_codes rc JOIN lock05f_targets t ON t.auth_user_id=rc.user_id WHERE rc.id=r.referral_code_id))
 THEN RAISE EXCEPTION 'lock05f_test_referrer_contract_mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.payment_v2_purchases p JOIN lock05f_targets t ON p.claimed_profile_id=t.profile_id)
 OR EXISTS(SELECT 1 FROM public.payment_v2_allocations a JOIN lock05f_targets t ON a.profile_id=t.profile_id)
 OR EXISTS(SELECT 1 FROM public.payment_v2_holds h JOIN lock05f_targets t ON h.referrer_auth_user_id=t.auth_user_id OR h.referrer_profile_id=t.profile_id)
 OR EXISTS(SELECT 1 FROM public.affiliate_ledger l JOIN lock05f_targets t ON l.affiliate_user_id=t.profile_id OR l.referred_user_id=t.auth_user_id)
 THEN RAISE EXCEPTION 'lock05f_payment_or_affiliate_relationship'; END IF;
 -- The five verified target-bearing edges are the only permitted FK dependencies.
 FOR fk IN SELECT c.conrelid::regclass rel,quote_ident(a.attname) col,c.confrelid
   FROM pg_constraint c JOIN LATERAL unnest(c.conkey) k(attnum) ON true JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
   WHERE c.contype='f' AND c.confrelid IN ('auth.users'::regclass,'public.profiles'::regclass)
     AND NOT ((c.conrelid,a.attname,c.confrelid) IN (
       ('public.profiles'::regclass,'id','auth.users'::regclass),
       ('public.user_subscriptions'::regclass,'user_id','public.profiles'::regclass),
       ('public.referral_codes'::regclass,'user_id','auth.users'::regclass),
       ('public.referral_tracking'::regclass,'referred_user_id','auth.users'::regclass),
       ('public.commission_earnings'::regclass,'referred_user_id','auth.users'::regclass)
     ))
 LOOP
  EXECUTE format('select count(*) from %s x join lock05f_targets t on x.%s=%s',fk.rel,fk.col,CASE WHEN fk.confrelid='auth.users'::regclass THEN 't.auth_user_id' ELSE 't.profile_id' END) INTO hit;
  IF hit<>0 THEN RAISE EXCEPTION 'lock05f_unexpected_dependency: %.%',fk.rel,fk.col; END IF;
 END LOOP;
 -- No stale-owned referral code may participate in any referral or financial history.
 FOR fk IN SELECT c.conrelid::regclass rel,quote_ident(a.attname) col
   FROM pg_constraint c JOIN LATERAL unnest(c.conkey) k(attnum) ON true JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
   WHERE c.contype='f' AND c.confrelid='public.referral_codes'::regclass
 LOOP
  EXECUTE format('select count(*) from %s x join lock05f_target_codes t on x.%s=t.id',fk.rel,fk.col) INTO hit;
  IF hit<>0 THEN RAISE EXCEPTION 'lock05f_stale_code_dependency: %.%',fk.rel,fk.col; END IF;
 END LOOP;
END $guard$;

CREATE SCHEMA lock05f_backup_20260812_pre_cleanup AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA lock05f_backup_20260812_pre_cleanup FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE lock05f_backup_20260812_pre_cleanup.manifest AS SELECT
 '8cc080017d947719761fdc98c49bc960112972f0'::text baseline_sha,clock_timestamp() backup_timestamp,21 target_count,21 referral_code_count,
 '879c8a17-f9e8-473d-8de1-1fd1a77c080e'::uuid protected_admin_uuid,pg_catalog.encode(extensions.digest(lower('admin@sirensforge.vip'),'sha256'),'hex') protected_admin_email_sha256;
CREATE TABLE lock05f_backup_20260812_pre_cleanup.profiles AS SELECT t.profile_id,t.auth_user_id,to_jsonb(p)-'password_hash' profile_without_password_hash FROM public.profiles p JOIN lock05f_targets t ON t.profile_id=p.id;
CREATE TABLE lock05f_backup_20260812_pre_cleanup.user_subscriptions AS SELECT to_jsonb(s) subscription_row FROM public.user_subscriptions s JOIN lock05f_targets t ON t.profile_id=s.user_id;
CREATE TABLE lock05f_backup_20260812_pre_cleanup.auth_user_audit AS SELECT u.id,u.email,u.created_at,u.updated_at,u.last_sign_in_at FROM auth.users u JOIN lock05f_targets t ON t.auth_user_id=u.id;
CREATE TABLE lock05f_backup_20260812_pre_cleanup.referral_codes AS SELECT to_jsonb(r) referral_code_row FROM public.referral_codes r JOIN lock05f_target_codes x ON x.id=r.id;
CREATE TABLE lock05f_backup_20260812_pre_cleanup.referral_tracking AS SELECT to_jsonb(r) referral_tracking_row FROM public.referral_tracking r JOIN lock05f_test_tracking x ON x.id=r.id;
CREATE TABLE lock05f_backup_20260812_pre_cleanup.commission_earnings AS SELECT to_jsonb(c) commission_earning_row FROM public.commission_earnings c JOIN lock05f_test_commission x ON x.id=c.id;
ALTER TABLE lock05f_backup_20260812_pre_cleanup.manifest OWNER TO postgres; ALTER TABLE lock05f_backup_20260812_pre_cleanup.profiles OWNER TO postgres;
ALTER TABLE lock05f_backup_20260812_pre_cleanup.user_subscriptions OWNER TO postgres; ALTER TABLE lock05f_backup_20260812_pre_cleanup.auth_user_audit OWNER TO postgres;
ALTER TABLE lock05f_backup_20260812_pre_cleanup.referral_codes OWNER TO postgres; ALTER TABLE lock05f_backup_20260812_pre_cleanup.referral_tracking OWNER TO postgres; ALTER TABLE lock05f_backup_20260812_pre_cleanup.commission_earnings OWNER TO postgres;
REVOKE ALL ON ALL TABLES IN SCHEMA lock05f_backup_20260812_pre_cleanup FROM PUBLIC,anon,authenticated,service_role;
DO $verify$ BEGIN
 IF (SELECT count(*) FROM lock05f_backup_20260812_pre_cleanup.profiles)<>21 OR (SELECT count(*) FROM lock05f_backup_20260812_pre_cleanup.auth_user_audit)<>21
 OR (SELECT count(*) FROM lock05f_backup_20260812_pre_cleanup.user_subscriptions)<>20 OR (SELECT count(*) FROM lock05f_backup_20260812_pre_cleanup.referral_codes)<>21
 OR (SELECT count(*) FROM lock05f_backup_20260812_pre_cleanup.referral_tracking)<>1 OR (SELECT count(*) FROM lock05f_backup_20260812_pre_cleanup.commission_earnings)<>1
 OR EXISTS(SELECT 1 FROM lock05f_backup_20260812_pre_cleanup.profiles WHERE profile_without_password_hash?'password_hash')
 THEN RAISE EXCEPTION 'lock05f_backup_verification_failed'; END IF;
END $verify$;
COMMIT;
