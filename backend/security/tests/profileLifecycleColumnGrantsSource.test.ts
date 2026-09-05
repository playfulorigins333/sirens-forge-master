import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/20260905031400_profile_lifecycle_column_select_grants.sql";
const migration = readFileSync(migrationPath, "utf8");
const uncomment = (sql: string) => sql.replace(/--.*$/gm, "");
const approvedProfileColumns = new Set([
  "id", "email", "seat_number", "is_og_vip", "tokens", "badge", "created_at", "user_id", "tier",
  "referral_code", "referred_by", "stripe_customer_id", "stripe_subscription_id", "subscription_status",
  "is_beta_tester", "og_seat_number", "updated_at", "username", "full_name", "avatar_url", "role",
  "clerk_id", "last_login_at", "metadata", "stripe_connect_account_id", "must_change_password", "is_tester",
  "stripe_connect_onboarded", "referral_email_sent_at", "total_generations", "account_lifecycle_state",
  "account_lifecycle_updated_at",
]);

test("migration grants exactly the two lifecycle columns without widening profile access", () => {
  const sql = uncomment(migration);
  const grants = [...sql.matchAll(/\bgrant\s+select\s*\(([\s\S]*?)\)\s+on\s+(?:table\s+)?public\.profiles\s+to\s+authenticated\s*;/gi)];
  assert.equal(grants.length, 1);
  assert.deepEqual(grants[0][1].split(",").map(column => column.trim()).filter(Boolean), [
    "account_lifecycle_state", "account_lifecycle_updated_at",
  ]);
  assert.doesNotMatch(sql, /\bgrant\s+select\s+on\s+(?:table\s+)?public\.profiles\s+to\s+authenticated\b/i);
  assert.doesNotMatch(sql, /\bgrant\b[^;]*\bpassword_hash\b[^;]*\bto\s+authenticated\b/i);
  assert.doesNotMatch(sql, /\bgrant\b[^;]*\bon\s+(?:table\s+)?public\.profiles\s+to\s+(?:public|anon)\b/i);
  assert.equal((sql.match(/^\s*grant\b/gim) ?? []).length, 1);
  assert.doesNotMatch(sql, /\b(?:create|alter|drop)\s+policy\b|\b(?:enable|disable|force|no\s+force)\s+row\s+level\s+security\b/i);
  assert.doesNotMatch(sql, /^\s*(?:insert|update|delete|truncate)\b/im);
});

test("every application lifecycle profile read stays within the explicit safe-column allowlist", () => {
  const sources = ["lib/subscription-checker.ts", "lib/account-access.ts", "lib/supabaseServer.ts"];
  let coveredLifecycleReads = 0;
  for (const path of sources) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/\.from\(["']profiles["']\)[\s\S]{0,160}?\.select\(["']([^"']+)["']\)/g)) {
      const columns = match[1].split(",").map(column => column.trim());
      if (!columns.some(column => column.startsWith("account_lifecycle_"))) continue;
      coveredLifecycleReads += 1;
      assert.deepEqual(columns.filter(column => !approvedProfileColumns.has(column)), [], `${path} selects an unapproved profile column`);
    }
  }
  assert.equal(coveredLifecycleReads, 3);
  assert.ok(!approvedProfileColumns.has("password_hash"));
});
