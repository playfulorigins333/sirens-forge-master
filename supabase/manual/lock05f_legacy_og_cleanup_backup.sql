-- MANUAL ONLY. Review against Production read-only catalog evidence before execution.
-- This artifact snapshots the pinned legacy population without authentication secrets.
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

DO $guard$
BEGIN
 IF (SELECT count(*) FROM lock05f_targets)<>21 THEN RAISE EXCEPTION 'lock05f_expected_21_targets'; END IF;
 IF (SELECT array_agg(coalesce(seat_number,og_seat_number) ORDER BY coalesce(seat_number,og_seat_number)) FROM lock05f_targets)
      IS DISTINCT FROM ARRAY(SELECT generate_series(1,21)) THEN RAISE EXCEPTION 'lock05f_seat_population_mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM lock05f_targets WHERE seat_number IS DISTINCT FROM og_seat_number)
    THEN RAISE EXCEPTION 'lock05f_seat_columns_mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.profiles p JOIN lock05f_targets t ON t.profile_id=p.id
           WHERE lower(p.email)='admin@sirensforge.vip' OR p.role='admin'
              OR p.id='879c8a17-f9e8-473d-8de1-1fd1a77c080e' OR p.user_id='879c8a17-f9e8-473d-8de1-1fd1a77c080e')
    THEN RAISE EXCEPTION 'lock05f_protected_admin_or_role_targeted'; END IF;
 IF (SELECT count(*) FROM auth.users u JOIN lock05f_targets t ON t.auth_user_id=u.id)<>21
    THEN RAISE EXCEPTION 'lock05f_auth_population_mismatch'; END IF;
 IF (SELECT count(*) FROM public.user_subscriptions s JOIN lock05f_targets t ON t.profile_id=s.user_id
     WHERE s.tier_name='og_throne')<>20 THEN RAISE EXCEPTION 'lock05f_expected_20_subscriptions'; END IF;
 IF EXISTS(SELECT 1 FROM public.user_subscriptions s JOIN lock05f_targets t ON t.profile_id=s.user_id WHERE s.tier_name<>'og_throne')
    THEN RAISE EXCEPTION 'lock05f_unexpected_subscription'; END IF;
 IF EXISTS(SELECT 1 FROM public.payment_v2_purchases p JOIN lock05f_targets t ON p.claimed_profile_id=t.profile_id)
 OR EXISTS(SELECT 1 FROM public.payment_v2_allocations a JOIN lock05f_targets t ON a.profile_id=t.profile_id)
 OR EXISTS(SELECT 1 FROM public.payment_v2_holds h JOIN lock05f_targets t ON h.referrer_auth_user_id=t.auth_user_id OR h.referrer_profile_id=t.profile_id)
    THEN RAISE EXCEPTION 'lock05f_payment_v2_relationship'; END IF;
 IF EXISTS(SELECT 1 FROM public.affiliate_ledger l JOIN lock05f_targets t ON l.affiliate_user_id=t.profile_id OR l.referred_user_id=t.auth_user_id)
 OR EXISTS(SELECT 1 FROM public.referral_codes r JOIN lock05f_targets t ON r.user_id=t.auth_user_id)
    THEN RAISE EXCEPTION 'lock05f_finance_or_referral_relationship'; END IF;
END $guard$;

CREATE SCHEMA lock05f_backup_20260812_pre_cleanup AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA lock05f_backup_20260812_pre_cleanup FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE lock05f_backup_20260812_pre_cleanup.manifest AS SELECT
 'e47e641048b48ed858b9fe21af7c0169fe0575c2'::text baseline_sha,
 'lock05f_legacy_og_cleanup_backup.sql'::text cleanup_artifact,
 clock_timestamp() backup_timestamp,21::integer target_count,
 '879c8a17-f9e8-473d-8de1-1fd1a77c080e'::uuid protected_admin_uuid,
 encode(digest(lower('admin@sirensforge.vip'),'sha256'),'hex') protected_admin_email_sha256,
 '1-21'::text expected_seat_range,20::integer expected_subscription_row_count;
CREATE TABLE lock05f_backup_20260812_pre_cleanup.profiles AS
 SELECT t.profile_id,t.auth_user_id,to_jsonb(p)-'password_hash' AS profile_without_password_hash
 FROM public.profiles p JOIN lock05f_targets t ON t.profile_id=p.id;
CREATE TABLE lock05f_backup_20260812_pre_cleanup.user_subscriptions AS
 SELECT to_jsonb(s) AS subscription_row FROM public.user_subscriptions s JOIN lock05f_targets t ON t.profile_id=s.user_id;
CREATE TABLE lock05f_backup_20260812_pre_cleanup.auth_user_audit AS
 SELECT u.id,u.email,u.created_at,u.updated_at,u.last_sign_in_at FROM auth.users u JOIN lock05f_targets t ON t.auth_user_id=u.id;
ALTER TABLE lock05f_backup_20260812_pre_cleanup.manifest OWNER TO postgres;
ALTER TABLE lock05f_backup_20260812_pre_cleanup.profiles OWNER TO postgres;
ALTER TABLE lock05f_backup_20260812_pre_cleanup.user_subscriptions OWNER TO postgres;
ALTER TABLE lock05f_backup_20260812_pre_cleanup.auth_user_audit OWNER TO postgres;
REVOKE ALL ON ALL TABLES IN SCHEMA lock05f_backup_20260812_pre_cleanup FROM PUBLIC,anon,authenticated,service_role;

DO $verify$
BEGIN
 IF (SELECT count(*) FROM lock05f_backup_20260812_pre_cleanup.profiles)<>21
 OR (SELECT count(*) FROM lock05f_backup_20260812_pre_cleanup.auth_user_audit)<>21
 OR (SELECT count(*) FROM lock05f_backup_20260812_pre_cleanup.user_subscriptions)<>20
 OR EXISTS(SELECT 1 FROM lock05f_backup_20260812_pre_cleanup.profiles WHERE profile_without_password_hash ? 'password_hash')
 THEN RAISE EXCEPTION 'lock05f_backup_verification_failed'; END IF;
END $verify$;
COMMIT;
