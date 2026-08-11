BEGIN;

DO $lock05b$
DECLARE
  profiles_oid oid := to_regclass('public.profiles');
  expected_columns text[] := ARRAY['id','email','seat_number','is_og_vip','tokens','badge','created_at','user_id','tier','referral_code','referred_by','stripe_customer_id','stripe_subscription_id','subscription_status','is_beta_tester','og_seat_number','updated_at','username','full_name','avatar_url','role','clerk_id','last_login_at','metadata','stripe_connect_account_id','must_change_password','password_hash','is_tester','stripe_connect_onboarded','referral_email_sent_at','total_generations'];
  actual_columns text[];
  expected_attribute_acls text[] := ARRAY['stripe_connect_account_id:service_role:postgres:UPDATE','stripe_connect_onboarded:service_role:postgres:UPDATE','stripe_customer_id:service_role:postgres:UPDATE'];
  actual_attribute_acls text[];
BEGIN
  SELECT array_agg(a.attname ORDER BY a.attnum) INTO actual_columns
  FROM pg_attribute a WHERE a.attrelid = profiles_oid AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT array_agg(format('%s:%s:%s:%s', a.attname, r.rolname, g.rolname, x.privilege_type) ORDER BY a.attname, r.rolname, g.rolname, x.privilege_type)
    INTO actual_attribute_acls
  FROM pg_attribute a
  CROSS JOIN LATERAL aclexplode(a.attacl) x
  JOIN pg_roles r ON r.oid = x.grantee
  JOIN pg_roles g ON g.oid = x.grantor
  WHERE a.attrelid = profiles_oid AND a.attnum > 0 AND NOT a.attisdropped;

  IF profiles_oid IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE c.oid=profiles_oid AND c.relkind='r' AND r.rolname='postgres' AND c.relrowsecurity AND NOT c.relforcerowsecurity)
     OR actual_columns IS DISTINCT FROM expected_columns
     OR NOT has_table_privilege('authenticated', profiles_oid, 'SELECT')
     OR has_table_privilege('anon', profiles_oid, 'SELECT')
     OR NOT has_table_privilege('service_role', profiles_oid, 'SELECT')
     OR NOT has_column_privilege('authenticated', profiles_oid, 'password_hash', 'SELECT')
     OR has_column_privilege('anon', profiles_oid, 'password_hash', 'SELECT')
     OR NOT has_column_privilege('service_role', profiles_oid, 'password_hash', 'SELECT')
     OR actual_attribute_acls IS DISTINCT FROM expected_attribute_acls
     OR NOT EXISTS (
       SELECT 1 FROM pg_policy p
       WHERE p.polrelid=profiles_oid AND p.polname='profiles_authenticated_own_select'
         AND p.polcmd='r' AND NOT p.polpermissive IS FALSE
         AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]
         AND pg_get_expr(p.polqual,p.polrelid)='(user_id = auth.uid())' AND p.polwithcheck IS NULL)
     OR (SELECT count(*) FROM pg_policy WHERE polrelid=profiles_oid AND polcmd='r') <> 1
  THEN RAISE EXCEPTION 'LOCK05B_DRIFT: public.profiles verified pre-state does not match';
  END IF;
END $lock05b$;

REVOKE SELECT ON TABLE public.profiles FROM authenticated;
GRANT SELECT (
  id, email, seat_number, is_og_vip, tokens, badge, created_at, user_id, tier,
  referral_code, referred_by, stripe_customer_id, stripe_subscription_id,
  subscription_status, is_beta_tester, og_seat_number, updated_at, username,
  full_name, avatar_url, role, clerk_id, last_login_at, metadata,
  stripe_connect_account_id, must_change_password, is_tester,
  stripe_connect_onboarded, referral_email_sent_at, total_generations
) ON public.profiles TO authenticated;

DO $lock05b$
DECLARE
  profiles_oid oid := to_regclass('public.profiles');
  approved text[] := ARRAY['id','email','seat_number','is_og_vip','tokens','badge','created_at','user_id','tier','referral_code','referred_by','stripe_customer_id','stripe_subscription_id','subscription_status','is_beta_tester','og_seat_number','updated_at','username','full_name','avatar_url','role','clerk_id','last_login_at','metadata','stripe_connect_account_id','must_change_password','is_tester','stripe_connect_onboarded','referral_email_sent_at','total_generations'];
  expected_attribute_acls text[] := ARRAY['stripe_connect_account_id:service_role:postgres:UPDATE','stripe_connect_onboarded:service_role:postgres:UPDATE','stripe_customer_id:service_role:postgres:UPDATE'];
  actual_attribute_acls text[];
BEGIN
  SELECT array_agg(format('%s:%s:%s:%s', a.attname, r.rolname, g.rolname, x.privilege_type) ORDER BY a.attname, r.rolname, g.rolname, x.privilege_type)
  INTO actual_attribute_acls FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x JOIN pg_roles r ON r.oid=x.grantee JOIN pg_roles g ON g.oid=x.grantor
  WHERE a.attrelid=profiles_oid AND a.attnum>0 AND NOT a.attisdropped AND r.rolname='service_role';
  IF has_table_privilege('authenticated', profiles_oid, 'SELECT')
     OR has_column_privilege('authenticated', profiles_oid, 'password_hash', 'SELECT')
     OR EXISTS (SELECT 1 FROM unnest(approved) c WHERE NOT has_column_privilege('authenticated',profiles_oid,c,'SELECT'))
     OR has_table_privilege('anon',profiles_oid,'SELECT') OR has_column_privilege('anon',profiles_oid,'password_hash','SELECT')
     OR NOT has_table_privilege('service_role',profiles_oid,'SELECT') OR NOT has_column_privilege('service_role',profiles_oid,'password_hash','SELECT')
     OR NOT has_table_privilege('postgres',profiles_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR actual_attribute_acls IS DISTINCT FROM expected_attribute_acls
     OR (SELECT count(*) FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE a.attrelid=profiles_oid AND x.grantee=(SELECT oid FROM pg_roles WHERE rolname='authenticated') AND x.privilege_type='SELECT' AND a.attname=ANY(approved)) <> 30
     OR (SELECT count(*) FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE a.attrelid=profiles_oid) <> 33
     OR NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE c.oid=profiles_oid AND r.rolname='postgres' AND c.relrowsecurity AND NOT c.relforcerowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=profiles_oid AND p.polname='profiles_authenticated_own_select' AND p.polcmd='r' AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')] AND pg_get_expr(p.polqual,p.polrelid)='(user_id = auth.uid())' AND p.polwithcheck IS NULL)
     OR (SELECT count(*) FROM pg_policy WHERE polrelid=profiles_oid AND polcmd='r') <> 1
  THEN RAISE EXCEPTION 'LOCK05B_POSTCONDITION_FAILED: containment state was not established'; END IF;
END $lock05b$;

COMMIT;
