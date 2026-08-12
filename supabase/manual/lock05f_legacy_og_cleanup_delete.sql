-- MANUAL DESTRUCTIVE ARTIFACT. Run only after the separately reviewed backup artifact.
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
DECLARE fk record; hit bigint; before_holds bigint; before_purchases bigint; before_allocations bigint; before_affiliate bigint;
BEGIN
 IF to_regnamespace('lock05f_backup_20260812_pre_cleanup') IS NULL THEN RAISE EXCEPTION 'lock05f_private_backup_required'; END IF;
 IF (SELECT count(*) FROM lock05f_backup_20260812_pre_cleanup.profiles)<>21
 OR (SELECT count(*) FROM lock05f_backup_20260812_pre_cleanup.auth_user_audit)<>21
 OR (SELECT count(*) FROM lock05f_backup_20260812_pre_cleanup.user_subscriptions)<>20 THEN RAISE EXCEPTION 'lock05f_backup_incomplete'; END IF;
 IF (SELECT count(*) FROM lock05f_targets)<>21 THEN RAISE EXCEPTION 'lock05f_expected_21_targets'; END IF;
 IF (SELECT array_agg(coalesce(seat_number,og_seat_number) ORDER BY coalesce(seat_number,og_seat_number)) FROM lock05f_targets)
      IS DISTINCT FROM ARRAY(SELECT generate_series(1,21))
 OR EXISTS(SELECT 1 FROM lock05f_targets WHERE seat_number IS DISTINCT FROM og_seat_number)
 THEN RAISE EXCEPTION 'lock05f_seat_population_mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.profiles p JOIN lock05f_targets t ON t.profile_id=p.id
   WHERE lower(p.email)='admin@sirensforge.vip' OR p.role='admin'
      OR p.id='879c8a17-f9e8-473d-8de1-1fd1a77c080e' OR p.user_id='879c8a17-f9e8-473d-8de1-1fd1a77c080e')
 THEN RAISE EXCEPTION 'lock05f_protected_admin_or_role_targeted'; END IF;
 IF (SELECT count(*) FROM auth.users
      WHERE id='879c8a17-f9e8-473d-8de1-1fd1a77c080e' AND lower(email)='admin@sirensforge.vip')<>1
    THEN RAISE EXCEPTION 'lock05f_protected_admin_auth_precondition'; END IF;
 IF (SELECT count(*) FROM public.profiles
      WHERE id='879c8a17-f9e8-473d-8de1-1fd1a77c080e'
        AND user_id='879c8a17-f9e8-473d-8de1-1fd1a77c080e'
        AND lower(email)='admin@sirensforge.vip' AND is_og_vip IS FALSE
        AND seat_number IS NULL AND og_seat_number IS NULL)<>1
    THEN RAISE EXCEPTION 'lock05f_protected_admin_profile_precondition'; END IF;
 IF EXISTS(SELECT 1 FROM lock05f_targets
           WHERE profile_id='879c8a17-f9e8-473d-8de1-1fd1a77c080e' OR auth_user_id='879c8a17-f9e8-473d-8de1-1fd1a77c080e')
    THEN RAISE EXCEPTION 'lock05f_protected_admin_in_target'; END IF;
 IF (SELECT count(*) FROM public.user_subscriptions s
      WHERE s.tier_name='og_throne' AND NOT EXISTS(SELECT 1 FROM lock05f_targets t WHERE t.profile_id=s.user_id))<>1
 OR (SELECT count(*) FROM public.user_subscriptions s
     WHERE s.tier_name='og_throne' AND s.user_id='879c8a17-f9e8-473d-8de1-1fd1a77c080e')<>1
    THEN RAISE EXCEPTION 'lock05f_protected_admin_subscription_precondition'; END IF;

 -- Catalog contract: profiles -> auth.users is the one expected restrictive edge.
 IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.contype='f' AND c.conrelid='public.profiles'::regclass
   AND c.confrelid='auth.users'::regclass AND c.confdeltype IN ('a','r')) THEN RAISE EXCEPTION 'lock05f_profiles_auth_fk_contract_changed'; END IF;
 -- Dynamically reject every other target-bearing NO ACTION/RESTRICT FK to auth.users or profiles.
 FOR fk IN SELECT c.conrelid::regclass rel,quote_ident(a.attname) col,c.confrelid
   FROM pg_constraint c JOIN LATERAL unnest(c.conkey) k(attnum) ON true
   JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
   WHERE c.contype='f' AND c.confrelid IN ('auth.users'::regclass,'public.profiles'::regclass)
     AND c.confdeltype IN ('a','r') AND c.conrelid NOT IN ('public.profiles'::regclass,'public.user_subscriptions'::regclass)
 LOOP
   EXECUTE format('select count(*) from %s x join lock05f_targets t on x.%s = %s',fk.rel,fk.col,
     CASE WHEN fk.confrelid='auth.users'::regclass THEN 't.auth_user_id' ELSE 't.profile_id' END) INTO hit;
   IF hit<>0 THEN RAISE EXCEPTION 'lock05f_restrict_dependency: %.%',fk.rel,fk.col; END IF;
 END LOOP;

 IF EXISTS(SELECT 1 FROM public.payment_v2_purchases p JOIN lock05f_targets t ON p.claimed_profile_id=t.profile_id)
 OR EXISTS(SELECT 1 FROM public.payment_v2_allocations a JOIN lock05f_targets t ON a.profile_id=t.profile_id)
 OR EXISTS(SELECT 1 FROM public.payment_v2_holds h JOIN lock05f_targets t ON h.referrer_auth_user_id=t.auth_user_id OR h.referrer_profile_id=t.profile_id)
 THEN RAISE EXCEPTION 'lock05f_payment_v2_relationship'; END IF;
 IF EXISTS(SELECT 1 FROM public.affiliate_ledger l JOIN lock05f_targets t ON l.affiliate_user_id=t.profile_id OR l.referred_user_id=t.auth_user_id)
 OR EXISTS(SELECT 1 FROM public.referral_codes r JOIN lock05f_targets t ON r.user_id=t.auth_user_id)
 THEN RAISE EXCEPTION 'lock05f_finance_or_referral_relationship'; END IF;

 -- Fail closed for meaningful creator/generation/autopost/crypto/dataset/LoRA tables.
 FOR fk IN SELECT c.conrelid::regclass rel,quote_ident(a.attname) col,c.confrelid
   FROM pg_constraint c JOIN LATERAL unnest(c.conkey) k(attnum) ON true
   JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
   WHERE c.contype='f' AND c.confrelid IN ('auth.users'::regclass,'public.profiles'::regclass)
     AND c.conrelid::regclass::text ~ '(creator|publishing|platform|autopost|generation|lora|dataset|crypto|commission|payout|affiliate|referral)'
 LOOP
   EXECUTE format('select count(*) from %s x join lock05f_targets t on x.%s = %s',fk.rel,fk.col,
     CASE WHEN fk.confrelid='auth.users'::regclass THEN 't.auth_user_id' ELSE 't.profile_id' END) INTO hit;
   IF hit<>0 THEN RAISE EXCEPTION 'lock05f_meaningful_dependency: %.%',fk.rel,fk.col; END IF;
 END LOOP;

 SELECT count(*) INTO before_holds FROM public.payment_v2_holds;
 SELECT count(*) INTO before_purchases FROM public.payment_v2_purchases;
 SELECT count(*) INTO before_allocations FROM public.payment_v2_allocations;
 SELECT count(*) INTO before_affiliate FROM public.affiliate_ledger;
 CREATE TEMP TABLE lock05f_unchanged_counts ON COMMIT DROP AS SELECT before_holds holds,before_purchases purchases,before_allocations allocations,before_affiliate affiliate;
END $guard$;

-- Proven order: intended profile-owned subscriptions, profiles, then auth identities.
DELETE FROM public.user_subscriptions s USING lock05f_targets t WHERE s.user_id=t.profile_id AND s.tier_name='og_throne';
DELETE FROM public.profiles p USING lock05f_targets t WHERE p.id=t.profile_id;
DELETE FROM auth.users u USING lock05f_targets t WHERE u.id=t.auth_user_id;

DO $post$
BEGIN
 IF EXISTS(SELECT 1 FROM public.profiles WHERE is_og_vip IS TRUE AND coalesce(seat_number,og_seat_number) BETWEEN 1 AND 21)
 OR EXISTS(SELECT 1 FROM public.profiles p JOIN lock05f_targets t ON p.id=t.profile_id)
 OR EXISTS(SELECT 1 FROM auth.users u JOIN lock05f_targets t ON u.id=t.auth_user_id)
 OR EXISTS(SELECT 1 FROM public.user_subscriptions s JOIN lock05f_targets t ON s.user_id=t.profile_id AND s.tier_name='og_throne')
 THEN RAISE EXCEPTION 'lock05f_stale_postcondition_failed'; END IF;
 IF (SELECT count(*) FROM public.profiles WHERE id='879c8a17-f9e8-473d-8de1-1fd1a77c080e')<>1
 OR (SELECT count(*) FROM auth.users WHERE id='879c8a17-f9e8-473d-8de1-1fd1a77c080e' AND lower(email)='admin@sirensforge.vip')<>1
 THEN RAISE EXCEPTION 'lock05f_protected_admin_postcondition_failed'; END IF;
 IF (SELECT count(*) FROM public.payment_v2_holds)<>(SELECT holds FROM lock05f_unchanged_counts)
 OR (SELECT count(*) FROM public.payment_v2_purchases)<>(SELECT purchases FROM lock05f_unchanged_counts)
 OR (SELECT count(*) FROM public.payment_v2_allocations)<>(SELECT allocations FROM lock05f_unchanged_counts)
 OR (SELECT count(*) FROM public.affiliate_ledger)<>(SELECT affiliate FROM lock05f_unchanged_counts)
 THEN RAISE EXCEPTION 'lock05f_financial_state_changed'; END IF;
END $post$;
COMMIT;
