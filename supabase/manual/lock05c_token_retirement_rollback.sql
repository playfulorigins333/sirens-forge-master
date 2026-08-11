BEGIN;
DO $$ BEGIN
 IF current_user<>'postgres' OR to_regclass('lock05c_backup_20260811_pre_apply.manifest') IS NULL
 OR (SELECT value FROM lock05c_backup_20260811_pre_apply.manifest WHERE key='baseline_sha')<>'3b3075c903f292c10dbe8423f85fe4702f6e30c7'
 OR to_regclass('public.token_packs') IS NOT NULL OR to_regclass('public.token_transactions') IS NOT NULL
 OR EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND (table_name,column_name) IN (('profiles','tokens'),('generations','tokens_cost'),('purchases','tokens_received'),('referrals','reward_tokens'),('system_stats','tokens_purchased'),('system_stats','tokens_spent'),('crypto_payments','token_pack_id')))
 OR EXISTS(SELECT FROM public.profiles WHERE tier='token_only') OR to_regprocedure('public.initialize_new_user()') IS NOT NULL
 OR NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND conname='check_tier_valid' AND pg_get_constraintdef(oid) NOT LIKE '%token_only%')
 OR EXISTS(
   (SELECT column_name,grantee,grantor,privilege_type,is_grantable FROM lock05c_backup_20260811_pre_apply.profile_column_grants WHERE column_name<>'tokens'
    EXCEPT
    SELECT a.attname,CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,grantor.rolname,x.privilege_type,x.is_grantable
    FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl)x LEFT JOIN pg_roles grantee ON grantee.oid=x.grantee JOIN pg_roles grantor ON grantor.oid=x.grantor
    WHERE a.attrelid='public.profiles'::regclass AND a.attnum>0 AND NOT a.attisdropped)
   UNION ALL
   (SELECT a.attname,CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,grantor.rolname,x.privilege_type,x.is_grantable
    FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl)x LEFT JOIN pg_roles grantee ON grantee.oid=x.grantee JOIN pg_roles grantor ON grantor.oid=x.grantor
    WHERE a.attrelid='public.profiles'::regclass AND a.attnum>0 AND NOT a.attisdropped
    EXCEPT SELECT column_name,grantee,grantor,privilege_type,is_grantable FROM lock05c_backup_20260811_pre_apply.profile_column_grants WHERE column_name<>'tokens')
 )
 THEN RAISE EXCEPTION 'LOCK05C_ROLLBACK_DRIFT'; END IF;
END $$;

CREATE TABLE public.token_packs (LIKE lock05c_backup_20260811_pre_apply.token_packs INCLUDING ALL);
INSERT INTO public.token_packs
 (id,name,display_name,tokens,price_usd,stripe_price_id,bonus_tokens,is_active,sort_order,popular,created_at,updated_at)
SELECT id,name,display_name,tokens,price_usd,stripe_price_id,bonus_tokens,is_active,sort_order,popular,created_at,updated_at
FROM lock05c_backup_20260811_pre_apply.token_packs;
CREATE TABLE public.token_transactions (LIKE lock05c_backup_20260811_pre_apply.token_transactions INCLUDING ALL);
INSERT INTO public.token_transactions SELECT * FROM lock05c_backup_20260811_pre_apply.token_transactions;
ALTER TABLE public.token_packs OWNER TO postgres;
ALTER TABLE public.token_transactions OWNER TO postgres;

DO $$ DECLARE x record; BEGIN
 FOR x IN SELECT * FROM lock05c_backup_20260811_pre_apply.column_types ORDER BY table_name,column_name LOOP
  EXECUTE format('ALTER TABLE public.%I ADD COLUMN %I %s',x.table_name,x.column_name,x.data_type);
 END LOOP;
END $$;
ALTER TABLE public.profiles DROP CONSTRAINT check_tier_valid;
UPDATE public.profiles p SET tier=b.tier,tokens=b.tokens FROM lock05c_backup_20260811_pre_apply.profile_state b WHERE p.id=b.id AND p.user_id IS NOT DISTINCT FROM b.user_id;
UPDATE public.generations g SET tokens_cost=b.tokens_cost FROM lock05c_backup_20260811_pre_apply.generations_tokens b WHERE g.id=b.id;
UPDATE public.purchases p SET tokens_received=b.tokens_received FROM lock05c_backup_20260811_pre_apply.purchases_tokens b WHERE p.id=b.id;
UPDATE public.referrals r SET reward_tokens=b.reward_tokens FROM lock05c_backup_20260811_pre_apply.referrals_tokens b WHERE r.id=b.id;
UPDATE public.crypto_payments c SET token_pack_id=b.token_pack_id FROM lock05c_backup_20260811_pre_apply.crypto_payment_tokens b WHERE c.id=b.id;
DROP TRIGGER on_auth_user_created ON auth.users;
DO $$ DECLARE x record; BEGIN
 FOR x IN SELECT * FROM lock05c_backup_20260811_pre_apply.column_defaults WHERE default_expression IS NOT NULL LOOP EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT %s',x.table_name,x.column_name,x.default_expression); END LOOP;
 FOR x IN SELECT * FROM lock05c_backup_20260811_pre_apply.constraints LOOP EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',x.table_name,x.conname,x.definition); END LOOP;
 FOR x IN SELECT * FROM lock05c_backup_20260811_pre_apply.functions LOOP EXECUTE x.definition; EXECUTE format('ALTER FUNCTION %s OWNER TO %I',x.identity,x.owner); EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',x.identity); END LOOP;
 FOR x IN SELECT * FROM lock05c_backup_20260811_pre_apply.function_grants WHERE grantee NOT IN ('postgres') LOOP EXECUTE format('GRANT %s ON FUNCTION %s TO %s%s',x.privilege_type,x.identity,CASE WHEN x.grantee='PUBLIC' THEN 'PUBLIC' ELSE format('%I',x.grantee) END,CASE WHEN x.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END); END LOOP;
 FOR x IN SELECT * FROM lock05c_backup_20260811_pre_apply.triggers LOOP EXECUTE x.definition; IF x.tgenabled='D' THEN EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I',x.table_name,x.tgname); ELSIF x.tgenabled='R' THEN EXECUTE format('ALTER TABLE %s ENABLE REPLICA TRIGGER %I',x.table_name,x.tgname); ELSIF x.tgenabled='A' THEN EXECUTE format('ALTER TABLE %s ENABLE ALWAYS TRIGGER %I',x.table_name,x.tgname); END IF; END LOOP;
 FOR x IN SELECT * FROM lock05c_backup_20260811_pre_apply.column_types WHERE attnotnull LOOP EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL',x.table_name,x.column_name); END LOOP;
END $$;
DO $$ DECLARE x record; BEGIN
 FOR x IN SELECT * FROM lock05c_backup_20260811_pre_apply.profile_column_grants ORDER BY column_name,grantee,privilege_type LOOP EXECUTE format('GRANT %s (%I) ON public.profiles TO %s%s',x.privilege_type,x.column_name,CASE WHEN x.grantee='PUBLIC' THEN 'PUBLIC' ELSE format('%I',x.grantee) END,CASE WHEN x.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END); END LOOP;
 FOR x IN SELECT * FROM lock05c_backup_20260811_pre_apply.table_security WHERE relname IN ('token_packs','token_transactions') LOOP IF x.relrowsecurity THEN EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',x.relname); END IF; IF x.relforcerowsecurity THEN EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',x.relname); END IF; END LOOP;
 FOR x IN SELECT * FROM lock05c_backup_20260811_pre_apply.policies WHERE table_name IN ('token_packs','token_transactions') ORDER BY table_name,policy_name LOOP
  EXECUTE format(
   'CREATE POLICY %I ON public.%I AS %s FOR %s TO %s%s%s',
   x.policy_name,
   x.table_name,
   CASE WHEN x.is_permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
   CASE x.command WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' ELSE NULL END,
   (SELECT string_agg(CASE WHEN role_name='PUBLIC' THEN 'PUBLIC' ELSE format('%I',role_name) END,', ' ORDER BY role_name) FROM unnest(x.role_names) role_name),
   CASE WHEN x.using_expression IS NULL THEN '' ELSE format(' USING (%s)',x.using_expression) END,
   CASE WHEN x.with_check_expression IS NULL THEN '' ELSE format(' WITH CHECK (%s)',x.with_check_expression) END
  );
 END LOOP;
 FOR x IN SELECT * FROM lock05c_backup_20260811_pre_apply.grants LOOP EXECUTE format('GRANT %s ON public.%I TO %I',x.privilege_type,x.table_name,x.grantee); END LOOP;
END $$;

DO $$ BEGIN
 IF (SELECT count(*) FROM public.token_packs)<>(SELECT count(*) FROM lock05c_backup_20260811_pre_apply.token_packs)
 OR (SELECT count(*) FROM pg_attribute a WHERE a.attrelid='public.token_packs'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated<>'')<>1
 OR NOT EXISTS(
   SELECT FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid='public.token_packs'::regclass AND a.attname='total_tokens'
    AND a.atttypid='integer'::regtype AND a.attgenerated='s'
    AND pg_get_expr(d.adbin,d.adrelid)='(tokens + bonus_tokens)'
 )
 OR EXISTS(SELECT FROM public.token_packs WHERE total_tokens IS DISTINCT FROM tokens+bonus_tokens)
 OR EXISTS(
   (SELECT id,name,display_name,tokens,price_usd,stripe_price_id,bonus_tokens,total_tokens,is_active,sort_order,popular,created_at,updated_at FROM public.token_packs
    EXCEPT
    SELECT id,name,display_name,tokens,price_usd,stripe_price_id,bonus_tokens,total_tokens,is_active,sort_order,popular,created_at,updated_at FROM lock05c_backup_20260811_pre_apply.token_packs)
   UNION ALL
   (SELECT id,name,display_name,tokens,price_usd,stripe_price_id,bonus_tokens,total_tokens,is_active,sort_order,popular,created_at,updated_at FROM lock05c_backup_20260811_pre_apply.token_packs
    EXCEPT
    SELECT id,name,display_name,tokens,price_usd,stripe_price_id,bonus_tokens,total_tokens,is_active,sort_order,popular,created_at,updated_at FROM public.token_packs)
 )
 OR (SELECT count(*) FROM public.token_transactions)<>(SELECT count(*) FROM lock05c_backup_20260811_pre_apply.token_transactions)
 OR EXISTS(SELECT FROM lock05c_backup_20260811_pre_apply.generations_tokens b FULL JOIN public.generations g USING(id) WHERE g.tokens_cost IS DISTINCT FROM b.tokens_cost)
 OR EXISTS(SELECT FROM lock05c_backup_20260811_pre_apply.profile_state b FULL JOIN public.profiles p USING(id) WHERE p.user_id IS DISTINCT FROM b.user_id OR p.tier IS DISTINCT FROM b.tier OR p.tokens IS DISTINCT FROM b.tokens)
 OR (SELECT count(*) FROM pg_proc WHERE oid IN ('public.handle_new_user()'::regprocedure,'public.initialize_new_user()'::regprocedure,'public.add_tokens(uuid,integer,text)'::regprocedure,'public.deduct_tokens(uuid,integer)'::regprocedure,'public.deduct_tokens(uuid,integer,text)'::regprocedure,'public.complete_referral_reward(uuid)'::regprocedure,'public.get_user_stats(uuid)'::regprocedure))<>7
 OR NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='on_auth_user_created' AND tgrelid='auth.users'::regclass AND NOT tgisinternal)
 OR NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='on_profile_created' AND tgrelid='public.profiles'::regclass AND NOT tgisinternal)
 OR EXISTS(
   (SELECT column_name,grantee,grantor,privilege_type,is_grantable FROM lock05c_backup_20260811_pre_apply.profile_column_grants
    EXCEPT
    SELECT a.attname,CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,grantor.rolname,x.privilege_type,x.is_grantable
    FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl)x LEFT JOIN pg_roles grantee ON grantee.oid=x.grantee JOIN pg_roles grantor ON grantor.oid=x.grantor
    WHERE a.attrelid='public.profiles'::regclass AND a.attnum>0 AND NOT a.attisdropped)
   UNION ALL
   (SELECT a.attname,CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,grantor.rolname,x.privilege_type,x.is_grantable
    FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl)x LEFT JOIN pg_roles grantee ON grantee.oid=x.grantee JOIN pg_roles grantor ON grantor.oid=x.grantor
    WHERE a.attrelid='public.profiles'::regclass AND a.attnum>0 AND NOT a.attisdropped
    EXCEPT SELECT column_name,grantee,grantor,privilege_type,is_grantable FROM lock05c_backup_20260811_pre_apply.profile_column_grants)
 )
 OR (SELECT count(*) FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl)x WHERE a.attrelid='public.profiles'::regclass AND a.attnum>0 AND NOT a.attisdropped)<>33
 OR (SELECT count(*) FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl)x JOIN pg_roles r ON r.oid=x.grantee WHERE a.attrelid='public.profiles'::regclass AND a.attnum>0 AND NOT a.attisdropped AND r.rolname='authenticated' AND x.privilege_type='SELECT')<>30
 OR (SELECT count(*) FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl)x JOIN pg_roles r ON r.oid=x.grantee WHERE a.attrelid='public.profiles'::regclass AND a.attnum>0 AND NOT a.attisdropped AND r.rolname='service_role' AND x.privilege_type='UPDATE')<>3
 OR EXISTS(SELECT FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl)x JOIN pg_roles r ON r.oid=x.grantee WHERE a.attrelid='public.profiles'::regclass AND a.attnum>0 AND NOT a.attisdropped AND r.rolname='service_role' AND x.privilege_type='SELECT')
 OR has_table_privilege('authenticated','public.profiles','SELECT') OR has_column_privilege('authenticated','public.profiles','password_hash','SELECT') OR NOT has_table_privilege('service_role','public.profiles','SELECT') OR has_table_privilege('anon','public.profiles','SELECT')
 OR EXISTS(
   (SELECT table_name,policy_name,is_permissive,command,role_names,using_expression,with_check_expression FROM lock05c_backup_20260811_pre_apply.policies
    EXCEPT
    SELECT c.relname,p.polname,p.polpermissive,p.polcmd,
      ARRAY(SELECT CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE r.rolname END FROM unnest(p.polroles) role_oid LEFT JOIN pg_roles r ON r.oid=role_oid ORDER BY CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE r.rolname END)::text[],
      pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    WHERE p.polrelid IN ('public.profiles'::regclass,'public.token_packs'::regclass,'public.token_transactions'::regclass))
   UNION ALL
   (SELECT c.relname,p.polname,p.polpermissive,p.polcmd,
      ARRAY(SELECT CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE r.rolname END FROM unnest(p.polroles) role_oid LEFT JOIN pg_roles r ON r.oid=role_oid ORDER BY CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE r.rolname END)::text[],
      pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    WHERE p.polrelid IN ('public.profiles'::regclass,'public.token_packs'::regclass,'public.token_transactions'::regclass)
    EXCEPT
    SELECT table_name,policy_name,is_permissive,command,role_names,using_expression,with_check_expression FROM lock05c_backup_20260811_pre_apply.policies)
 )
 OR EXISTS(SELECT FROM information_schema.columns WHERE table_schema='lock05c_backup_20260811_pre_apply' AND column_name='password_hash')
 THEN RAISE EXCEPTION 'LOCK05C_ROLLBACK_POSTCONDITION_FAILED'; END IF;
END $$;
COMMIT;
