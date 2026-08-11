import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const deleted=["app/api/checkout/tokens/route.ts","lib/tokens/packs.ts","lib/tokens/index.ts","lib/tokens/adjust.ts","lib/tokens/history.ts"];
const targets=["app/account/page.tsx","app/billing/page.tsx","app/api/user/subscription/route.ts","hooks/useSubscription.ts","lib/subscription-checker.ts"];
const migration=readFileSync("supabase/migrations/20260811070000_lock05c_permanent_token_retirement.sql","utf8");
const backup=readFileSync("supabase/manual/lock05c_token_retirement_backup.sql","utf8");
const rollback=readFileSync("supabase/manual/lock05c_token_retirement_rollback.sql","utf8");

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
test("rollback is separately guarded and restores from backup identity",()=>{
 assert.match(rollback,/LOCK05C_ROLLBACK_DRIFT/); assert.match(rollback,/LOCK05C_ROLLBACK_POSTCONDITION_FAILED/); assert.doesNotMatch(rollback,/\bCASCADE\b/i); assert.match(rollback,/SET tier=b\.tier,tokens=b\.tokens/);
});
test("legitimate token names remain in active source",()=>{
 const active=execFileSync("git",["grep","-nE","(access_token|refresh_token|claim_token|lock_token|trigger_token|max_tokens)","--","app","lib","backend"],{encoding:"utf8"});
 assert.match(active,/access_token/); assert.match(active,/claim_token/); assert.match(active,/lock_token/); assert.match(active,/trigger_token/); assert.match(active,/max_tokens/);
});
