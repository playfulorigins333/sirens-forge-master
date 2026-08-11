import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20260811004900_lock03c2a_view_boundary.sql", "utf8");
const rollback = readFileSync("supabase/manual/lock03c2a_view_boundary_rollback.sql", "utf8");
const uncomment = (sql: string) => sql.replace(/--.*$/gm, "");
const targets = new Set(["lora_notification_payload", "dataset_doctor_review_v"]);
const objectNames = (sql: string) => new Set(
  [...sql.matchAll(/public\.([a-z][a-z0-9_]*)/gi)].map((match) => match[1].toLowerCase()),
);

test("forward migration changes exactly the two approved views", () => {
  const sql = uncomment(migration);
  assert.deepEqual([...objectNames(sql)].sort(), [...targets].sort());
  assert.match(sql, /^\s*begin\s*;/i);
  assert.match(sql, /commit\s*;\s*$/i);
  assert.match(sql, /LOCK03C2A_DRIFT/);
  assert.match(sql, /LOCK03C2A_POSTCONDITION_FAILED/);

  assert.match(sql, /revoke\s+select\s+on\s+public\.lora_notification_payload\s+from\s+anon/i);
  assert.match(sql, /revoke\s+select\s+on\s+public\.lora_notification_payload\s+from\s+authenticated/i);
  assert.doesNotMatch(sql, /alter\s+view\s+public\.lora_notification_payload/i);
  assert.doesNotMatch(sql, /revoke[^;]*lora_notification_payload[^;]*service_role/i);

  assert.match(sql, /alter\s+view\s+public\.dataset_doctor_review_v\s+set\s*\(\s*security_invoker\s*=\s*true\s*\)/i);
  assert.match(sql, /revoke\s+select\s+on\s+public\.dataset_doctor_review_v\s+from\s+anon/i);
  assert.match(sql, /revoke\s+select\s+on\s+public\.dataset_doctor_review_v\s+from\s+authenticated/i);
  assert.doesNotMatch(sql, /revoke[^;]*dataset_doctor_review_v[^;]*service_role/i);
});

test("forward migration contains no broader database changes", () => {
  const sql = uncomment(migration);
  const excluded = [
    "sale_counters", "payment_v2", "add_tokens", "deduct_tokens",
    "record_lora_terminal_status", "creator_publishing_platform_account_clear_trusted_metadata",
    "get_my_affiliate_ledger_summary",
  ];
  for (const name of excluded) assert.doesNotMatch(sql, new RegExp(`\\b${name}\\b`, "i"));
  assert.doesNotMatch(sql, /create\s+(or\s+replace\s+)?view/i);
  assert.doesNotMatch(sql, /\b(create|alter|drop)\s+function\b/i);
  assert.doesNotMatch(sql, /\balter\s+table\b|row\s+level\s+security|create\s+policy|drop\s+policy/i);
  assert.doesNotMatch(sql, /\b(insert(?:\s+into)?|update|delete(?:\s+from)?|truncate)\b/i);
  assert.doesNotMatch(sql, /\bgrant\b/i);
});

test("manual rollback restores only the approved pre-state", () => {
  const sql = uncomment(rollback);
  assert.deepEqual([...objectNames(sql)].sort(), [...targets].sort());
  assert.match(rollback, /EMERGENCY MANUAL ROLLBACK ONLY/);
  assert.match(rollback, /reopens the browser-readable security exposure/i);
  assert.match(rollback, /explicit human approval/i);
  assert.match(rollback, /Never run automatically/i);
  assert.match(rollback, /source-only preparation/i);
  assert.match(sql, /LOCK03C2A_ROLLBACK_DRIFT/);
  assert.match(sql, /LOCK03C2A_ROLLBACK_POSTCONDITION_FAILED/);
  assert.match(sql, /alter\s+view\s+public\.dataset_doctor_review_v\s+reset\s*\(\s*security_invoker\s*\)/i);
  for (const target of targets) {
    assert.match(sql, new RegExp(`grant\\s+select\\s+on\\s+public\\.${target}\\s+to\\s+anon`, "i"));
    assert.match(sql, new RegExp(`grant\\s+select\\s+on\\s+public\\.${target}\\s+to\\s+authenticated`, "i"));
  }
  assert.doesNotMatch(sql, /grant[^;]*service_role/i);
  assert.doesNotMatch(sql, /\brevoke\b|\b(create|alter|drop)\s+function\b|\balter\s+table\b/i);
  assert.doesNotMatch(sql, /\b(insert(?:\s+into)?|update|delete(?:\s+from)?|truncate)\b/i);
});
