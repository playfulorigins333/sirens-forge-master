-- EMERGENCY MANUAL ROLLBACK ONLY. Requires explicit human approval.
-- This reopens browser/Data API credential exposure. Never run automatically.
-- Source-only preparation: this file does not authorize execution anywhere.
BEGIN;

DO $lock05b$
DECLARE
  profiles_oid oid := to_regclass('public.profiles');
  approved text[] := ARRAY['id','email','seat_number','is_og_vip','tokens','badge','created_at','user_id','tier','referral_code','referred_by','stripe_customer_id','stripe_subscription_id','subscription_status','is_beta_tester','og_seat_number','updated_at','username','full_name','avatar_url','role','clerk_id','last_login_at','metadata','stripe_connect_account_id','must_change_password','is_tester','stripe_connect_onboarded','referral_email_sent_at','total_generations'];
BEGIN
  IF profiles_oid IS NULL OR has_table_privilege('authenticated',profiles_oid,'SELECT')
     OR has_column_privilege('authenticated',profiles_oid,'password_hash','SELECT')
     OR EXISTS (SELECT 1 FROM unnest(approved) c WHERE NOT has_column_privilege('authenticated',profiles_oid,c,'SELECT'))
     OR (SELECT count(*) FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE a.attrelid=profiles_oid AND x.grantee=(SELECT oid FROM pg_roles WHERE rolname='authenticated') AND x.privilege_type='SELECT') <> 30
     OR (SELECT count(*) FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE a.attrelid=profiles_oid) <> 33
     OR (SELECT count(*) FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE a.attrelid=profiles_oid AND x.grantee=(SELECT oid FROM pg_roles WHERE rolname='service_role') AND x.grantor=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND x.privilege_type='UPDATE' AND a.attname=ANY(ARRAY['stripe_customer_id','stripe_connect_account_id','stripe_connect_onboarded'])) <> 3
     OR has_table_privilege('anon',profiles_oid,'SELECT') OR has_column_privilege('anon',profiles_oid,'password_hash','SELECT')
     OR NOT has_table_privilege('service_role',profiles_oid,'SELECT') OR NOT has_column_privilege('service_role',profiles_oid,'password_hash','SELECT')
     OR NOT has_table_privilege('postgres',profiles_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE c.oid=profiles_oid AND r.rolname='postgres' AND c.relrowsecurity AND NOT c.relforcerowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=profiles_oid AND p.polname='profiles_authenticated_own_select' AND p.polcmd='r' AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')] AND pg_get_expr(p.polqual,p.polrelid)='(user_id = auth.uid())' AND p.polwithcheck IS NULL)
     OR (SELECT count(*) FROM pg_policy WHERE polrelid=profiles_oid AND polcmd='r') <> 1
  THEN RAISE EXCEPTION 'LOCK05B_ROLLBACK_DRIFT: expected LOCK-05B state not found'; END IF;
END $lock05b$;

REVOKE SELECT (
  id, email, seat_number, is_og_vip, tokens, badge, created_at, user_id, tier,
  referral_code, referred_by, stripe_customer_id, stripe_subscription_id,
  subscription_status, is_beta_tester, og_seat_number, updated_at, username,
  full_name, avatar_url, role, clerk_id, last_login_at, metadata,
  stripe_connect_account_id, must_change_password, is_tester,
  stripe_connect_onboarded, referral_email_sent_at, total_generations
) ON public.profiles FROM authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;

DO $lock05b$
DECLARE profiles_oid oid := to_regclass('public.profiles');
BEGIN
  IF NOT has_table_privilege('authenticated',profiles_oid,'SELECT')
     OR NOT has_column_privilege('authenticated',profiles_oid,'password_hash','SELECT')
     OR (SELECT count(*) FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE a.attrelid=profiles_oid AND x.grantee=(SELECT oid FROM pg_roles WHERE rolname='authenticated')) <> 0
     OR has_table_privilege('anon',profiles_oid,'SELECT') OR NOT has_table_privilege('service_role',profiles_oid,'SELECT')
     OR (SELECT count(*) FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE a.attrelid=profiles_oid) <> 3
     OR (SELECT count(*) FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE a.attrelid=profiles_oid AND x.grantee=(SELECT oid FROM pg_roles WHERE rolname='service_role') AND x.grantor=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND x.privilege_type='UPDATE' AND a.attname=ANY(ARRAY['stripe_customer_id','stripe_connect_account_id','stripe_connect_onboarded'])) <> 3
     OR NOT has_table_privilege('postgres',profiles_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE c.oid=profiles_oid AND r.rolname='postgres' AND c.relrowsecurity AND NOT c.relforcerowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=profiles_oid AND p.polname='profiles_authenticated_own_select' AND p.polcmd='r' AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')] AND pg_get_expr(p.polqual,p.polrelid)='(user_id = auth.uid())' AND p.polwithcheck IS NULL)
  THEN RAISE EXCEPTION 'LOCK05B_ROLLBACK_POSTCONDITION_FAILED: original privilege state not restored'; END IF;
END $lock05b$;

COMMIT;
