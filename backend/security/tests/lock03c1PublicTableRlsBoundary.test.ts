import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const targets = new Set(`lora_status_events sf_users models model_enrollments platform_connections approved_media posting_rules scheduled_posts post_logs campaign_links caption_templates hashtag_sets cta_variants content_generation_jobs content_usage_log autopost_settings autopost_runs autopost_run_results pfc03000_backup_profiles pfc03000_backup_referral_codes pfc03000_backup_referral_tracking pfc03000_backup_referrals pfc03000_backup_commission_earnings pfc03000_backup_commissions pfc03000_backup_affiliate_ledger pfc03000_backup_affiliate_payout_batches pfc03000_backup_affiliate_payout_items pfc03000_backup_payouts pfc03000_backup_catalog_snapshot`.split(/\s+/));
const migration = readFileSync("supabase/migrations/20260810003400_lock03c1_public_table_rls_boundary.sql", "utf8");
const rollback = readFileSync("supabase/manual/lock03c1_public_table_rls_rollback.sql", "utf8");
const uncomment = (sql: string) => sql.replace(/--.*$/gm, "");
const names = (matches: IterableIterator<RegExpMatchArray>) => new Set([...matches].map((match) => match[1].toLowerCase()));

function assertSame(actual: Set<string>, expected: Set<string>) {
  assert.deepEqual([...actual].sort(), [...expected].sort());
}

test("forward migration enables exactly the approved 29 tables", () => {
  const sql = uncomment(migration);
  const enabled = names(sql.matchAll(/alter\s+table\s+public\.([a-z0-9_]+)\s+enable\s+row\s+level\s+security\s*;/gi));
  const policyTables = names(sql.matchAll(/create\s+policy\s+lock03c1_deny_anon_authenticated\s+on\s+public\.([a-z0-9_]+)/gi));
  assert.equal(targets.size, 29);
  assertSame(enabled, targets);
  assertSame(policyTables, targets);
  assert.equal((sql.match(/enable\s+row\s+level\s+security/gi) ?? []).length, 29);
  assert.equal((sql.match(/create\s+policy\s+lock03c1_deny_anon_authenticated/gi) ?? []).length, 29);
  for (const block of sql.matchAll(/create\s+policy\s+lock03c1_deny_anon_authenticated([\s\S]*?);/gi)) {
    assert.match(block[1], /as\s+restrictive/i);
    assert.match(block[1], /for\s+all/i);
    assert.match(block[1], /to\s+anon\s*,\s*authenticated/i);
    assert.match(block[1], /using\s*\(\s*false\s*\)/i);
    assert.match(block[1], /with\s+check\s*\(\s*false\s*\)/i);
  }
});

test("forward migration contains only the table RLS boundary", () => {
  const sql = uncomment(migration);
  assert.match(sql, /^\s*begin\s*;/i);
  assert.match(sql, /commit\s*;\s*$/i);
  assert.match(sql, /LOCK03C1_DRIFT/);
  assert.match(sql, /LOCK03C1_POSTCONDITION_FAILED/);
  assert.doesNotMatch(sql, /disable\s+row\s+level\s+security|force\s+row\s+level\s+security/i);
  assert.doesNotMatch(sql, /\bgrant\b|\brevoke\b|drop\s+table|\btruncate\b/i);
  assert.doesNotMatch(sql, /\b(insert\s+into|update\s+public\.|delete\s+from)\b/i);
  assert.doesNotMatch(sql, /\b(create|alter|drop)\s+(view|function)\b/i);
  const altered = names(sql.matchAll(/alter\s+table\s+public\.([a-z0-9_]+)/gi));
  assertSame(altered, targets);
});

test("excluded runtime, view, and RPC objects are absent", () => {
  const sql = uncomment(migration);
  const excluded = [
    "autopost_accounts", "autopost_rules", "autopost_jobs", "autopost_job_logs",
    "payment_v2_holds", "payment_v2_purchases", "payment_v2_allocations", "payment_v2_reconciliation_evidence", "payment_v2_affiliate_recurring_invoices",
    "profiles", "referral_codes", "referral_tracking", "referrals", "commission_earnings", "commissions", "affiliate_ledger", "affiliate_payout_batches", "affiliate_payout_items", "payouts",
    "user_loras", "dataset_doctor_jobs", "dataset_doctor_images", "dataset_doctor_selections", "generations", "user_subscriptions", "subscription_tiers",
    "lora_notification_payload", "dataset_doctor_review_v", "sale_counters", "add_tokens", "deduct_tokens", "record_lora_terminal_status", "creator_publishing_platform_account_clear_trusted_metadata", "get_my_affiliate_ledger_summary",
  ];
  for (const object of excluded) assert.doesNotMatch(sql, new RegExp(`public\\.${object}\\b`, "i"));
  assert.doesNotMatch(sql, /public\.creator_publishing_[a-z0-9_]+/i);
});

test("manual rollback is explicit and limited to the same 29 tables", () => {
  const sql = uncomment(rollback);
  assert.match(rollback, /EMERGENCY MANUAL ROLLBACK ONLY/);
  assert.match(rollback, /reopen a known public-data security exposure/i);
  assert.match(rollback, /explicit human approval/i);
  assert.match(rollback, /never run automatically/i);
  const dropped = names(sql.matchAll(/drop\s+policy\s+lock03c1_deny_anon_authenticated\s+on\s+public\.([a-z0-9_]+)/gi));
  const disabled = names(sql.matchAll(/alter\s+table\s+public\.([a-z0-9_]+)\s+disable\s+row\s+level\s+security/gi));
  assertSame(dropped, targets);
  assertSame(disabled, targets);
  assert.equal((sql.match(/drop\s+policy\s+lock03c1_deny_anon_authenticated/gi) ?? []).length, 29);
  assert.equal((sql.match(/disable\s+row\s+level\s+security/gi) ?? []).length, 29);
  assert.doesNotMatch(sql, /\bgrant\b|\brevoke\b|drop\s+table|\btruncate\b|\b(insert\s+into|update\s+public\.|delete\s+from)\b/i);
  assert.doesNotMatch(sql, /\b(create|alter|drop)\s+(view|function)\b/i);
});
