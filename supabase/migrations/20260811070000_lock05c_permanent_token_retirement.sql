BEGIN;

DO $lock05c$
DECLARE
  p oid := to_regclass('public.profiles');
  approved text[] := ARRAY['id','email','seat_number','is_og_vip','tokens','badge','created_at','user_id','tier','referral_code','referred_by','stripe_customer_id','stripe_subscription_id','subscription_status','is_beta_tester','og_seat_number','updated_at','username','full_name','avatar_url','role','clerk_id','last_login_at','metadata','stripe_connect_account_id','must_change_password','is_tester','stripe_connect_onboarded','referral_email_sent_at','total_generations'];
  f regprocedure;
BEGIN
  IF p IS NULL OR NOT EXISTS (SELECT FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE c.oid=p AND r.rolname='postgres' AND c.relrowsecurity AND NOT c.relforcerowsecurity)
     OR has_table_privilege('authenticated',p,'SELECT') OR has_column_privilege('authenticated',p,'password_hash','SELECT')
     OR EXISTS (SELECT FROM unnest(approved) c WHERE NOT has_column_privilege('authenticated',p,c,'SELECT'))
     OR has_table_privilege('anon',p,'SELECT') OR NOT has_table_privilege('service_role',p,'SELECT')
     OR NOT EXISTS (SELECT FROM pg_policy WHERE polrelid=p AND polname='profiles_authenticated_own_select' AND polcmd='r' AND polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')] AND pg_get_expr(polqual,polrelid)='(user_id = auth.uid())' AND polwithcheck IS NULL)
     OR (SELECT count(*) FROM pg_policy WHERE polrelid=p AND polcmd='r')<>1
  THEN RAISE EXCEPTION 'LOCK05C_DRIFT: LOCK-05B profile containment'; END IF;

  IF NOT EXISTS (SELECT FROM pg_attribute WHERE attrelid=p AND attname='tokens' AND atttypid='bigint'::regtype AND NOT attnotnull AND NOT attisdropped)
     OR (SELECT pg_get_expr(adbin,adrelid) FROM pg_attrdef WHERE adrelid=p AND adnum=(SELECT attnum FROM pg_attribute WHERE attrelid=p AND attname='tokens')) IS DISTINCT FROM '500'::text
     OR (SELECT count(*) FROM public.profiles)<>22 OR EXISTS (SELECT FROM public.profiles WHERE tokens IS NULL OR tokens<>0)
     OR to_regclass('public.token_transactions') IS NULL OR (SELECT count(*) FROM public.token_transactions)<>0
     OR to_regclass('public.token_packs') IS NULL OR (SELECT count(*) FROM public.token_packs)<>3
     OR (SELECT array_agg(stripe_price_id ORDER BY stripe_price_id) FROM public.token_packs) IS DISTINCT FROM ARRAY['price_1SScdNFjcWRhhOnz4fdtkych','price_1SSce8FjcWRhhOnz9lAXHETb','price_1SSceqFjcWRhhOnzfkiKHhGX']
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.token_transactions'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.token_packs'::regclass)
     OR (SELECT count(*) FROM public.generations)<>10 OR EXISTS(SELECT FROM public.generations WHERE tokens_cost<>1 OR tokens_cost IS NULL)
     OR (SELECT count(*) FROM public.purchases)<>0 OR (SELECT count(*) FROM public.referrals)<>0 OR (SELECT count(*) FROM public.system_stats)<>0 OR (SELECT count(*) FROM public.crypto_payments)<>0
     OR (SELECT count(*) FROM public.profiles WHERE tier='token_only')<>1
     OR EXISTS (SELECT FROM public.profiles pr WHERE pr.tier='token_only' AND NOT EXISTS (SELECT FROM public.user_subscriptions us WHERE us.user_id=pr.id AND lower(us.status) IN ('active','trialing') AND us.tier_name='og_throne'))
  THEN RAISE EXCEPTION 'LOCK05C_DRIFT: economic token prestate or entitlement safety'; END IF;

  IF (SELECT count(*) FROM pg_trigger WHERE tgfoid='public.initialize_new_user()'::regprocedure AND NOT tgisinternal)<>1
     OR NOT EXISTS (SELECT FROM pg_trigger WHERE tgname='on_profile_created' AND tgrelid=p AND tgfoid='public.initialize_new_user()'::regprocedure AND NOT tgisinternal)
     OR NOT EXISTS (SELECT FROM pg_trigger WHERE tgname='on_auth_user_created' AND tgrelid='auth.users'::regclass AND tgfoid='public.handle_new_user()'::regprocedure AND NOT tgisinternal AND tgenabled<>'D')
  THEN RAISE EXCEPTION 'LOCK05C_DRIFT: signup trigger dependencies'; END IF;

  FOREACH f IN ARRAY ARRAY['public.add_tokens(uuid,integer,text)'::regprocedure,'public.deduct_tokens(uuid,integer)'::regprocedure,'public.deduct_tokens(uuid,integer,text)'::regprocedure,'public.complete_referral_reward(uuid)'::regprocedure,'public.get_user_stats(uuid)'::regprocedure]
  LOOP
    IF (SELECT count(*) FROM pg_depend WHERE refobjid=f AND deptype NOT IN ('n','a','i'))<>0 THEN RAISE EXCEPTION 'LOCK05C_DRIFT: unexpected dependency on %',f; END IF;
  END LOOP;

  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid=p AND conname='check_tier_valid' AND pg_get_constraintdef(oid) LIKE '%token_only%')
     OR (SELECT pg_get_expr(adbin,adrelid) FROM pg_attrdef WHERE adrelid=p AND adnum=(SELECT attnum FROM pg_attribute WHERE attrelid=p AND attname='tier')) NOT LIKE '%token_only%'
     OR EXISTS (SELECT FROM public.crypto_payments WHERE token_pack_id IS NOT NULL)
     OR NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='public.crypto_payments'::regclass AND conname='crypto_payments_token_pack_id_fkey' AND confrelid='public.token_packs'::regclass)
  THEN RAISE EXCEPTION 'LOCK05C_DRIFT: tier or crypto token-pack prestate'; END IF;
END $lock05c$;

CREATE TEMP TABLE lock05c_profile_snapshot ON COMMIT DROP AS SELECT id,user_id,tier FROM public.profiles;

UPDATE public.profiles SET tier='og_throne' WHERE tier='token_only';
ALTER TABLE public.profiles ALTER COLUMN tier DROP DEFAULT;
ALTER TABLE public.profiles DROP CONSTRAINT check_tier_valid;
ALTER TABLE public.profiles ADD CONSTRAINT check_tier_valid CHECK (tier IS NULL OR tier IN ('og_throne','monthly_29','monthly_59','monthly_79'));

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public, pg_temp
AS $function$
BEGIN
  INSERT INTO public.profiles (id,user_id,email,referral_code,badge,subscription_status,role,is_og_vip,is_beta_tester,must_change_password,created_at,updated_at)
  VALUES (NEW.id,NEW.id,NEW.email,public.generate_referral_code(),'Plebian','none','user',false,false,false,now(),now());
  RETURN NEW;
END
$function$;
ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

DROP TRIGGER on_profile_created ON public.profiles;
DROP FUNCTION public.initialize_new_user();
DROP FUNCTION public.complete_referral_reward(uuid);
DROP FUNCTION public.get_user_stats(uuid);
DROP FUNCTION public.add_tokens(uuid,integer,text);
DROP FUNCTION public.deduct_tokens(uuid,integer);
DROP FUNCTION public.deduct_tokens(uuid,integer,text);

ALTER TABLE public.crypto_payments DROP CONSTRAINT crypto_payments_token_pack_id_fkey;
ALTER TABLE public.crypto_payments DROP COLUMN token_pack_id;
ALTER TABLE public.profiles DROP COLUMN tokens;
ALTER TABLE public.generations DROP COLUMN tokens_cost;
ALTER TABLE public.purchases DROP COLUMN tokens_received;
ALTER TABLE public.purchases ALTER COLUMN purchase_type DROP DEFAULT;
ALTER TABLE public.referrals DROP COLUMN reward_tokens;
ALTER TABLE public.system_stats DROP COLUMN tokens_purchased;
ALTER TABLE public.system_stats DROP COLUMN tokens_spent;
DROP TABLE public.token_transactions;
DROP TABLE public.token_packs;

DO $lock05c$
DECLARE
 p oid:='public.profiles'::regclass;
 approved text[]:=ARRAY['id','email','seat_number','is_og_vip','badge','created_at','user_id','tier','referral_code','referred_by','stripe_customer_id','stripe_subscription_id','subscription_status','is_beta_tester','og_seat_number','updated_at','username','full_name','avatar_url','role','clerk_id','last_login_at','metadata','stripe_connect_account_id','must_change_password','is_tester','stripe_connect_onboarded','referral_email_sent_at','total_generations'];
BEGIN
 IF to_regclass('public.token_packs') IS NOT NULL OR to_regclass('public.token_transactions') IS NOT NULL
 OR EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND (table_name,column_name) IN (('profiles','tokens'),('generations','tokens_cost'),('purchases','tokens_received'),('referrals','reward_tokens'),('system_stats','tokens_purchased'),('system_stats','tokens_spent'),('crypto_payments','token_pack_id')))
 OR EXISTS(SELECT FROM pg_proc WHERE oid IN (to_regprocedure('public.add_tokens(uuid,integer,text)'),to_regprocedure('public.deduct_tokens(uuid,integer)'),to_regprocedure('public.deduct_tokens(uuid,integer,text)'),to_regprocedure('public.complete_referral_reward(uuid)'),to_regprocedure('public.get_user_stats(uuid)')))
 OR EXISTS(SELECT FROM public.profiles WHERE tier='token_only')
 OR EXISTS(SELECT FROM lock05c_profile_snapshot s FULL JOIN public.profiles p USING(id) WHERE p.user_id IS DISTINCT FROM s.user_id OR p.tier IS DISTINCT FROM CASE WHEN s.tier='token_only' THEN 'og_throne' ELSE s.tier END)
 OR (SELECT pg_get_expr(adbin,adrelid) FROM pg_attrdef WHERE adrelid=p AND adnum=(SELECT attnum FROM pg_attribute WHERE attrelid=p AND attname='tier')) IS NOT NULL
 OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid=p AND conname='check_tier_valid') LIKE '%token_only%'
 OR to_regprocedure('public.initialize_new_user()') IS NOT NULL OR EXISTS(SELECT FROM pg_trigger WHERE tgname='on_profile_created' AND tgrelid=p AND NOT tgisinternal)
 OR NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='on_auth_user_created' AND tgrelid='auth.users'::regclass AND tgfoid='public.handle_new_user()'::regprocedure AND tgenabled<>'D' AND NOT tgisinternal)
 OR NOT (SELECT prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp'] FROM pg_proc WHERE oid='public.handle_new_user()'::regprocedure)
 OR pg_get_functiondef('public.handle_new_user()'::regprocedure) ~* 'tokens|token_only'
 OR pg_get_functiondef('public.handle_new_user()'::regprocedure) !~ $contract$INSERT INTO public\.profiles \(id,user_id,email,referral_code,badge,subscription_status,role,is_og_vip,is_beta_tester,must_change_password,created_at,updated_at\)$contract$
 OR pg_get_functiondef('public.handle_new_user()'::regprocedure) !~ $contract$VALUES \(NEW\.id,NEW\.id,NEW\.email,public\.generate_referral_code\(\),'Plebian','none','user',false,false,false,now\(\),now\(\)\)$contract$
 OR has_table_privilege('authenticated',p,'SELECT') OR has_column_privilege('authenticated',p,'password_hash','SELECT')
 OR EXISTS(SELECT FROM unnest(approved) c WHERE NOT has_column_privilege('authenticated',p,c,'SELECT'))
 OR (SELECT count(*) FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl)x WHERE a.attrelid=p AND x.grantee=(SELECT oid FROM pg_roles WHERE rolname='authenticated') AND x.privilege_type='SELECT' AND a.attname=ANY(approved))<>29
 OR has_table_privilege('anon',p,'SELECT') OR NOT has_table_privilege('service_role',p,'SELECT') OR NOT has_table_privilege('postgres',p,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 OR NOT EXISTS(SELECT FROM pg_policy WHERE polrelid=p AND polname='profiles_authenticated_own_select' AND pg_get_expr(polqual,polrelid)='(user_id = auth.uid())')
 THEN RAISE EXCEPTION 'LOCK05C_POSTCONDITION_FAILED'; END IF;
END $lock05c$;
COMMIT;
