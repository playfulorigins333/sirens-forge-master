import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/20260821040658_final_supabase_least_privilege_hardening.sql";
const rollbackPath = "supabase/manual/final_supabase_least_privilege_hardening_rollback.sql";
const migration = readFileSync(migrationPath, "utf8");
const rollback = readFileSync(rollbackPath, "utf8");
const admin = readFileSync("lib/supabaseAdmin.ts", "utf8");
const helpers = [
  "autopost_accounts_preserve_fanvue_provider_identity()",
  "creator_publishing_aggregate_plan_status(uuid)",
  "creator_publishing_autopost_source_fingerprint(uuid)",
  "creator_publishing_job_source_is_current(uuid)",
  "creator_publishing_scheduler_validate_timezone(text)",
];
const sequences = ["autopost_job_logs_id_seq", "creator_publishing_audit_events_id_seq", "purchases_id_seq"];
const uncomment = (sql: string) => sql.replace(/--.*$/gm, "");

test("migration is transactional, fail-closed, explicit, and data-free", () => {
  const sql = uncomment(migration);
  assert.match(sql, /^\s*begin\s*;/i);
  assert.match(sql, /commit\s*;\s*$/i);
  for (const marker of ["STALE_GRANT_DRIFT", "NON_DATA_API_DRIFT", "FUNCTION_DRIFT", "DEFAULT_PRIVILEGE_DRIFT", "POSTCONDITION_FAILED"]) assert.match(sql, new RegExp(marker));
  assert.doesNotMatch(sql, /^\s*(insert(?:\s+into)?|update|delete(?:\s+from)?|truncate)\b/im);
  assert.doesNotMatch(sql, /\b(create|drop|alter)\s+policy\b|\b(enable|disable|force)\s+row\s+level\s+security\b/i);
  assert.doesNotMatch(sql, /\b(storage|auth)\s*\.|dataset_doctor.*(?:insert|update|delete)|payment_v2/i);
});

test("exact stale surface and non-Data-API privileges are revoked", () => {
  assert.match(migration, /FINAL_LP_INTERNAL_STALE_COUNT/);
  assert.match(migration, /<> 67/); // 66 privileges for two roles plus one anon-only privilege = 133 entries.
  assert.match(migration, /revoke delete, insert, select, update on table public\._backup_autopost_rules_before_content_payload_20250628_001 from anon, authenticated/i);
  assert.match(migration, /revoke select on table public\.creator_publishing_fanvue_attempts from anon;/i);
  assert.doesNotMatch(migration, /revoke select on table public\.creator_publishing_fanvue_attempts from anon, authenticated/i);
  assert.equal((migration.match(/revoke truncate, trigger, references, maintain on table public\./gi) ?? []).length, 55);
  assert.equal((migration.match(/revoke maintain on table public\.(?:autopost_accounts|creator_publishing_fanvue_attempts)/gi) ?? []).length, 2);
});

test("five internal helpers, the view, and three sequences are narrowly contained", () => {
  for (const helper of helpers) assert.match(migration, new RegExp(`revoke execute on function public\\.${helper.replace(/[()]/g, "\\$&")} from public, anon, authenticated`, "i"));
  assert.equal((migration.match(/revoke execute on function public\./gi) ?? []).length, 5);
  assert.doesNotMatch(migration, /(?:revoke|grant|alter)\s+[^;]*get_my_affiliate_ledger_summary/i);
  assert.match(migration, /revoke all privileges on table public\.creator_publishing_fanvue_history from anon, authenticated/i);
  for (const sequence of sequences) assert.match(migration, new RegExp(`revoke usage, select, update on sequence public\\.${sequence} from anon, authenticated`, "i"));
  assert.doesNotMatch(migration, /revoke[^;]*(?:service_role|postgres)/i);
});

test("only postgres public table/sequence defaults are narrowed", () => {
  assert.match(migration, /alter default privileges for role postgres in schema public revoke truncate, trigger, references, maintain on tables from anon, authenticated/i);
  assert.match(migration, /alter default privileges for role postgres in schema public revoke update on sequences from anon, authenticated/i);
  assert.doesNotMatch(migration, /alter default privileges[^;]*(?:functions|supabase_admin)/i);
});

test("rollback restores the audited prestate and remains manual-only", () => {
  for (const phrase of ["EMERGENCY MANUAL ROLLBACK ONLY", "fresh backup", "explicit human approval", "Never run automatically"]) assert.match(rollback, new RegExp(phrase, "i"));
  assert.match(rollback, /^--[\s\S]*\nbegin;/);
  assert.match(rollback, /FINAL_LP_ROLLBACK_DRIFT/);
  assert.match(rollback, /FINAL_LP_ROLLBACK_POSTCONDITION_FAILED/);
  assert.match(rollback, /commit;\s*$/);
});

test("Supabase admin client keeps the service-role key server-side by env contract", () => {
  assert.match(admin, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(admin, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/);
});
