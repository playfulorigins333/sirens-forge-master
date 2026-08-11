import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const migrationPath = "supabase/migrations/20260811043000_lock05b_profile_credential_containment.sql";
const rollbackPath = "supabase/manual/lock05b_profile_credential_containment_rollback.sql";
const migration = readFileSync(migrationPath, "utf8");
const rollback = readFileSync(rollbackPath, "utf8");
const uncomment = (sql: string) => sql.replace(/--.*$/gm, "");
const approved = ["id","email","seat_number","is_og_vip","tokens","badge","created_at","user_id","tier","referral_code","referred_by","stripe_customer_id","stripe_subscription_id","subscription_status","is_beta_tester","og_seat_number","updated_at","username","full_name","avatar_url","role","clerk_id","last_login_at","metadata","stripe_connect_account_id","must_change_password","is_tester","stripe_connect_onboarded","referral_email_sent_at","total_generations"];
const grantColumns = (sql: string, verb: "grant" | "revoke") => {
  const match = sql.match(new RegExp(`${verb}\\s+select\\s*\\(([\\s\\S]*?)\\)\\s+on\\s+public\\.profiles\\s+(?:to|from)\\s+authenticated\\s*;`, "i"));
  assert.ok(match, `${verb} column list missing`);
  return match[1].split(",").map(v => v.trim()).filter(Boolean);
};

test("forward migration is exactly the authenticated SELECT containment", () => {
  const sql = uncomment(migration);
  assert.match(sql, /^\s*begin\s*;/i); assert.match(sql, /commit\s*;\s*$/i);
  assert.match(sql, /LOCK05B_DRIFT/); assert.match(sql, /LOCK05B_POSTCONDITION_FAILED/);
  assert.match(sql, /revoke\s+select\s+on\s+table\s+public\.profiles\s+from\s+authenticated\s*;/i);
  assert.deepEqual(grantColumns(sql, "grant"), approved);
  assert.ok(!grantColumns(sql, "grant").includes("password_hash"));
  assert.equal((sql.match(/^\s*(?:grant|revoke)\b/gim) ?? []).length, 2);
});

test("forward migration rejects scope expansion and data mutation", () => {
  const sql = uncomment(migration);
  assert.doesNotMatch(sql, /\balter\s+table\b|\bcreate(?:\s+or\s+replace)?\s+(?:view|function)\b|\bdrop\b/i);
  assert.doesNotMatch(sql, /\b(?:create|alter|drop)\s+policy\b|(?:enable|disable|force|no\s+force)\s+row\s+level\s+security/i);
  assert.doesNotMatch(sql, /^\s*(?:delete|update|insert|truncate)\b/im);
  assert.doesNotMatch(sql, /alter\s+default\s+privileges|payment(?:_|\s*)v2/i);
  assert.doesNotMatch(sql, /^\s*(?:grant|revoke)[^;]*\b(?:anon|service_role|postgres)\b/im);
});

test("rollback removes the 30 grants and restores table SELECT only", () => {
  const sql = uncomment(rollback);
  assert.match(sql, /LOCK05B_ROLLBACK_DRIFT/); assert.match(sql, /LOCK05B_ROLLBACK_POSTCONDITION_FAILED/);
  assert.deepEqual(grantColumns(sql, "revoke"), approved);
  assert.match(sql, /grant\s+select\s+on\s+table\s+public\.profiles\s+to\s+authenticated\s*;/i);
  assert.equal((sql.match(/^\s*(?:grant|revoke)\b/gim) ?? []).length, 2);
  assert.doesNotMatch(sql, /^\s*(?:grant|revoke)[^;]*\b(?:anon|service_role|postgres)\b/im);
});

test("changed-file scope is exactly the five approved LOCK-05B files", () => {
  const expected = [".github/workflows/lock05b-profile-credential-containment.yml","backend/security/tests/lock05bProfileCredentialContainment.test.ts","backend/security/tests/runLock05bPostgresIntegration.mjs",rollbackPath,migrationPath].sort();
  const tracked = execFileSync("git", ["diff","--name-only","55aec335486a169669cb726783153dd1ff50b609","--"], {encoding:"utf8"}).trim().split("\n").filter(Boolean);
  const untracked = execFileSync("git", ["status","--porcelain=v1"], {encoding:"utf8"}).trim().split("\n").filter(v=>v.startsWith("?? ")).map(v=>v.slice(3));
  assert.deepEqual([...new Set([...tracked,...untracked])].sort(), expected);
});
