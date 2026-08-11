import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const deleted=["app/api/checkout/tokens/route.ts","lib/tokens/packs.ts","lib/tokens/index.ts","lib/tokens/adjust.ts","lib/tokens/history.ts"];
const targets=["app/account/page.tsx","app/billing/page.tsx","app/api/user/subscription/route.ts","hooks/useSubscription.ts","lib/subscription-checker.ts"];
const migration=readFileSync("supabase/migrations/20260811070000_lock05c_permanent_token_retirement.sql","utf8");
const backup=readFileSync("supabase/manual/lock05c_token_retirement_backup.sql","utf8");
const rollback=readFileSync("supabase/manual/lock05c_token_retirement_rollback.sql","utf8");
const integration=readFileSync("backend/security/tests/runLock05cPostgresIntegration.mjs","utf8");

test("economic-token routes and modules are permanently absent",()=>{
 for(const file of deleted) assert.equal(existsSync(file),false,file);
 let active=""; try { active=execFileSync("git",["grep","-nEI","(/api/checkout/tokens|lib/tokens|TOKEN_PACKS|price_1SScdNFjcWRhhOnz4fdtkych|price_1SSce8FjcWRhhOnz9lAXHETb|price_1SSceqFjcWRhhOnzfkiKHhGX)","--","app","lib","hooks"],{encoding:"utf8"}); } catch (error: any) { assert.equal(error.status,1); }
 assert.equal(active.trim(),"");
});
test("profile consumers neither select nor expose economic balances",()=>{
 for(const file of targets){const source=readFileSync(file,"utf8");assert.doesNotMatch(source,/\btokens\b|Token Balance/,file);}
});
test("forward retirement is transactional, guarded, narrow, and non-cascading",()=>{
 assert.match(migration,/^BEGIN;/); assert.match(migration,/COMMIT;\s*$/); assert.match(migration,/LOCK05C_DRIFT/); assert.match(migration,/LOCK05C_POSTCONDITION_FAILED/);
 assert.doesNotMatch(migration,/\bCASCADE\b/i); for(const object of ["profiles.*tokens","generations.*tokens_cost","purchases.*tokens_received","referrals.*reward_tokens","system_stats.*tokens_purchased","system_stats.*tokens_spent","crypto_payments.*token_pack_id","token_transactions","token_packs"]) assert.match(migration,new RegExp(object,"i"));
 assert.match(migration,/tier IN \('og_throne','monthly_29','monthly_59','monthly_79'\)/);
});
test("backup is private, baseline-pinned, and excludes password hashes",()=>{
 assert.match(backup,/lock05c_backup_20260811_pre_apply/); assert.match(backup,/3b3075c903f292c10dbe8423f85fe4702f6e30c7/); assert.match(backup,/REVOKE ALL ON SCHEMA[\s\S]*PUBLIC,anon,authenticated,service_role/i);
 assert.doesNotMatch(backup,/profile_state AS SELECT[^;]*password_hash/i); assert.match(backup,/column_name='password_hash'/);
});
test("token pack backup and rollback omit the generated column from explicit data copies",()=>{
 const columns="id,name,display_name,tokens,price_usd,stripe_price_id,bonus_tokens,is_active,sort_order,popular,created_at,updated_at";
 const backupInsert=backup.match(/INSERT INTO lock05c_backup_20260811_pre_apply\.token_packs\s*\(([^)]*)\)\s*SELECT\s+([^;]+?)\s+FROM public\.token_packs;/i);
 assert.ok(backupInsert); assert.equal(backupInsert[1].replace(/\s/g,""),columns); assert.equal(backupInsert[2].replace(/\s/g,""),columns);
 assert.doesNotMatch(backupInsert[0],/\btotal_tokens\b/i); assert.doesNotMatch(backupInsert[0],/SELECT\s+\*/i);
 const rollbackInsert=rollback.match(/INSERT INTO public\.token_packs\s*\(([^)]*)\)\s*SELECT\s+([^;]+?)\s+FROM lock05c_backup_20260811_pre_apply\.token_packs;/i);
 assert.ok(rollbackInsert); assert.equal(rollbackInsert[1].replace(/\s/g,""),columns); assert.equal(rollbackInsert[2].replace(/\s/g,""),columns);
 assert.doesNotMatch(rollbackInsert[0],/\btotal_tokens\b/i); assert.doesNotMatch(rollbackInsert[0],/SELECT\s+\*/i);
});
test("generated token totals are preserved and verified",()=>{
 for(const source of [backup,rollback]){
  assert.match(source,/a\.attname='total_tokens'/); assert.match(source,/a\.atttypid='integer'::regtype/);
  assert.match(source,/a\.attgenerated='s'/); assert.match(source,/pg_get_expr\(d\.adbin,d\.adrelid\)='\(tokens \+ bonus_tokens\)'/);
  assert.match(source,/total_tokens IS DISTINCT FROM tokens\+bonus_tokens/i);
 }
 assert.match(integration,/total_tokens integer generated always as \(tokens \+ bonus_tokens\) stored/i);
});
test("policies are backed up semantically and reconstructed without nonexistent helpers",()=>{
 assert.doesNotMatch(`${backup}\n${rollback}`,new RegExp(["pg","get","policydef"].join("_"),"i"));
 for(const field of ["table_name","policy_name","is_permissive","command","role_names","using_expression","with_check_expression"]) assert.match(backup,new RegExp(`\\b${field}\\b`));
 assert.match(backup,/pg_get_expr\(p\.polqual,p\.polrelid\)/); assert.match(backup,/pg_get_expr\(p\.polwithcheck,p\.polrelid\)/); assert.match(backup,/role_oid = 0 THEN 'PUBLIC'/);
 for(const mapping of ["'r' THEN 'SELECT'","'a' THEN 'INSERT'","'w' THEN 'UPDATE'","'d' THEN 'DELETE'","'\\*' THEN 'ALL'"]) assert.match(rollback,new RegExp(mapping));
 assert.match(rollback,/CREATE POLICY %I ON public\.%I AS %s FOR %s TO %s%s%s/); assert.match(rollback,/EXCEPT[\s\S]*UNION ALL[\s\S]*EXCEPT/);
});
test("replacement signup preserves audited non-economic behavior only",()=>{
 assert.match(migration,/SET search_path TO pg_catalog, public, pg_temp/);
 assert.match(migration,/INSERT INTO public\.profiles \(id,user_id,email,referral_code,badge,subscription_status,role,is_og_vip,is_beta_tester,must_change_password,created_at,updated_at\)/);
 assert.match(migration,/VALUES \(NEW\.id,NEW\.id,NEW\.email,public\.generate_referral_code\(\),'Plebian','none','user',false,false,false,now\(\),now\(\)\)/);
 const replacement=migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.handle_new_user()"),migration.indexOf("ALTER FUNCTION public.handle_new_user() OWNER"));
 assert.doesNotMatch(replacement,/founder|inactive|is_tester|token_only|\btokens\b/i);
});
test("profile column ACL backup and rollback use explicit attribute ACL semantics",()=>{
 const profileAclBackup=backup.slice(backup.indexOf("CREATE TABLE lock05c_backup_20260811_pre_apply.profile_column_grants"),backup.indexOf("CREATE TABLE lock05c_backup_20260811_pre_apply.grants"));
 assert.match(profileAclBackup,/FROM pg_attribute a/); assert.match(profileAclBackup,/CROSS JOIN LATERAL aclexplode\(a\.attacl\)/);
 assert.doesNotMatch(profileAclBackup,/information_schema\.column_privileges/);
 assert.match(profileAclBackup,/grantor\.rolname AS grantor/); assert.match(profileAclBackup,/x\.is_grantable/);
 assert.match(rollback,/profile_column_grants WHERE column_name<>'tokens'[\s\S]*EXCEPT[\s\S]*aclexplode\(a\.attacl\)/);
 assert.match(rollback,/aclexplode\(a\.attacl\)[\s\S]*EXCEPT SELECT column_name,grantee,grantor,privilege_type,is_grantable FROM lock05c_backup_20260811_pre_apply\.profile_column_grants/);
 assert.doesNotMatch(rollback,/GRANT SELECT \([^)]*\) ON public\.profiles TO service_role/i);
});
test("rollback is separately guarded and restores from backup identity",()=>{
 assert.match(rollback,/LOCK05C_ROLLBACK_DRIFT/); assert.match(rollback,/LOCK05C_ROLLBACK_POSTCONDITION_FAILED/); assert.doesNotMatch(rollback,/\bCASCADE\b/i); assert.match(rollback,/SET tier=b\.tier,tokens=b\.tokens/);
});
test("legitimate token names remain in active source",()=>{
 const active=execFileSync("git",["grep","-nE","(access_token|refresh_token|claim_token|lock_token|trigger_token|max_tokens)","--","app","lib","backend"],{encoding:"utf8"});
 assert.match(active,/access_token/); assert.match(active,/claim_token/); assert.match(active,/lock_token/); assert.match(active,/trigger_token/); assert.match(active,/max_tokens/);
});
