import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const migrationPath = "supabase/migrations/20260811013000_lock03c2b_function_execution_boundary.sql";
const rollbackPath = "supabase/manual/lock03c2b_function_execution_boundary_rollback.sql";
const migration = readFileSync(migrationPath, "utf8");
const rollback = readFileSync(rollbackPath, "utf8");
const uncomment = (sql: string) => sql.replace(/--.*$/gm, "");
const signatures = [
  "add_tokens\\(uuid, integer, text\\)", "deduct_tokens\\(uuid, integer\\)",
  "deduct_tokens\\(uuid, integer, text\\)", "record_lora_terminal_status\\(\\)",
  "creator_publishing_platform_account_clear_trusted_metadata\\(\\)",
];

test("forward migration contains only the five approved grant changes", () => {
  const sql = uncomment(migration);
  assert.match(sql, /^\s*begin\s*;/i);
  assert.match(sql, /commit\s*;\s*$/i);
  assert.match(sql, /LOCK03C2B_DRIFT/);
  assert.match(sql, /LOCK03C2B_POSTCONDITION_FAILED/);
  for (const signature of signatures) {
    for (const role of ["public", "anon", "authenticated"])
      assert.match(sql, new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${signature}\\s+from\\s+${role}\\s*;`, "i"));
  }
  assert.equal((sql.match(/revoke\s+execute\s+on\s+function/gi) ?? []).length, 15);
  assert.doesNotMatch(sql, /revoke[^;]*service_role|\bgrant\b/i);
});

test("forward migration is containment-only and verifies both triggers", () => {
  const sql = uncomment(migration);
  for (const forbidden of ["sale_counters", "lora_notification_payload", "dataset_doctor_review_v", "get_my_affiliate_ledger_summary", "payment_v2"])
    assert.doesNotMatch(sql, new RegExp(`\\b${forbidden}\\b`, "i"));
  assert.doesNotMatch(sql, /\b(drop|create(?:\s+or\s+replace)?|alter)\s+function\b|\b(create|drop|alter)\s+trigger\b|\balter\s+table\b/i);
  assert.doesNotMatch(sql, /^\s*(insert(?:\s+into)?|update|delete(?:\s+from)?|truncate)\b|\bpolicy\b|row\s+level\s+security|default\s+privileges|search_path/im);
  assert.match(sql, /user_loras[\s\S]*lora_terminal_status_trigger[\s\S]*record_lora_terminal_status/);
  assert.match(sql, /creator_platform_accounts[\s\S]*trg_creator_platform_accounts_clear_trusted_metadata[\s\S]*creator_publishing_platform_account_clear_trusted_metadata/);
});

test("manual rollback restores only the deliberately exposed pre-state", () => {
  const sql = uncomment(rollback);
  for (const text of ["EMERGENCY MANUAL ROLLBACK ONLY", "explicit human approval", "reopens direct browser/API execution exposure", "Never run automatically", "source-only preparation"])
    assert.match(rollback, new RegExp(text.replace("/", "\\/"), "i"));
  assert.match(sql, /LOCK03C2B_ROLLBACK_DRIFT/);
  assert.match(sql, /LOCK03C2B_ROLLBACK_POSTCONDITION_FAILED/);
  for (const signature of signatures) for (const role of ["public", "anon", "authenticated"])
    assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${signature}\\s+to\\s+${role}\\s*;`, "i"));
  assert.equal((sql.match(/grant\s+execute\s+on\s+function/gi) ?? []).length, 15);
  assert.doesNotMatch(sql, /\b(?:grant|revoke)\b[^;]*service_role|\brevoke\s+execute\s+on\s+function/i);
  assert.doesNotMatch(sql, /\b(drop|create(?:\s+or\s+replace)?|alter)\s+function\b|\b(create|drop|alter)\s+trigger\b|\balter\s+table\b|^\s*(insert|update|delete|truncate)\b/im);
});

test("changed-file scope is exactly the approved C2B set", () => {
  const expected = [
    ".github/workflows/lock03c2b-function-execution-boundary.yml",
    "backend/security/tests/lock03c2bFunctionExecutionBoundary.test.ts",
    "backend/security/tests/runLock03c2bPostgresIntegration.mjs",
    migrationPath, rollbackPath,
  ].sort();
  const tracked = execFileSync("git", ["diff", "--name-only", "81e8899b130299ab4ad63f0d6c8eeb990cf96e40", "--"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const untracked = execFileSync("git", ["status", "--porcelain=v1"], { encoding: "utf8" }).trim().split("\n").filter(line => line.startsWith("?? ")).map(line => line.slice(3));
  const changed = [...new Set([...tracked, ...untracked])].sort();
  assert.deepEqual(changed, expected);
});
