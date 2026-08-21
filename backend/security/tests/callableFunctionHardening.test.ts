import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/20260821005423_harden_callable_function_boundaries.sql";
const rollbackPath = "supabase/manual/harden_callable_function_boundaries_rollback.sql";
const migration = readFileSync(migrationPath, "utf8");
const rollback = readFileSync(rollbackPath, "utf8");
const signatures = [
  "auto_approve_caption_templates()", "auto_approve_cta_variants()", "auto_approve_hashtag_sets()", "claim_next_lora_job()",
  "creator_publishing_audit_events_prevent_mutation()", "creator_publishing_escalated_approved_has_review()",
  "creator_publishing_prevent_creator_controlled_field_update()", "creator_publishing_queue_jsonb_has_forbidden_credential_key(jsonb)",
  "dataset_doctor_images_enforce_parent_match()", "dataset_doctor_images_refresh_counts()", "dataset_doctor_mark_approved(uuid, text, text)",
  "dataset_doctor_mark_exported(uuid)", "dataset_doctor_queue_lora_training(uuid, text, text, integer)",
  "dataset_doctor_selections_enforce_parent_match()", "dataset_doctor_set_active_job(uuid, uuid)", "increment_generation_count()",
  "refresh_dataset_doctor_job_counts(uuid)", "set_updated_at()", "update_collection_item_count()", "update_collections_updated_at()",
  "update_updated_at_column()",
];
const publicPath = new Set(["auto_approve_caption_templates()", "auto_approve_cta_variants()", "auto_approve_hashtag_sets()", "increment_generation_count()", "update_collection_item_count()"]);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("forward migration targets exactly 21 approved functions", () => {
  assert.match(migration, /^-- Source-only[\s\S]*\nbegin;/);
  assert.match(migration, /CALLABLE_FUNCTION_HARDENING_DRIFT/);
  assert.match(migration, /CALLABLE_FUNCTION_HARDENING_POSTCONDITION_FAILED/);
  assert.doesNotMatch(migration, /get_my_affiliate_ledger_summary/i);
  for (const signature of signatures) {
    const path = publicPath.has(signature) ? "pg_catalog, public, pg_temp" : "pg_catalog, pg_temp";
    assert.match(migration, new RegExp(`alter function public\\.${esc(signature)} set search_path = ${path.replaceAll(", ", ",\\s*")};`, "i"));
    assert.match(migration, new RegExp(`revoke execute on function public\\.${esc(signature)} from public, anon, authenticated;`, "i"));
  }
  assert.equal((migration.match(/^alter function public\./gm) ?? []).length, 21);
  assert.equal((migration.match(/^revoke execute on function public\./gm) ?? []).length, 21);
  assert.doesNotMatch(migration, /revoke[^;]*service_role|create\s+(or replace\s+)?function|drop\s+function|alter\s+table/i);
});

test("preflight, postconditions, and trigger bindings fail closed", () => {
  for (const fact of ["owner_role.rolname <> 'postgres'", "p.prosecdef", "p.proconfig is not null", "aclexplode(p.proacl)", "t.tgenabled<>'D'"])
    assert.ok(migration.includes(fact), `missing guard: ${fact}`);
  for (const trigger of ["trg_auto_approve_caption_templates", "trg_dataset_doctor_images_refresh_counts", "increment_user_generations", "update_collection_items_count", "trigger_update_collections_timestamp"])
    assert.ok(migration.includes(trigger));
});

test("rollback restores only audited ACL and null search_path state", () => {
  assert.match(rollback, /EMERGENCY MANUAL ROLLBACK ONLY/i);
  assert.match(rollback, /CALLABLE_FUNCTION_ROLLBACK_DRIFT/);
  assert.match(rollback, /CALLABLE_FUNCTION_ROLLBACK_POSTCONDITION_FAILED/);
  assert.doesNotMatch(rollback, /get_my_affiliate_ledger_summary/i);
  for (const signature of signatures) {
    assert.match(rollback, new RegExp(`alter function public\\.${esc(signature)} reset search_path;`, "i"));
    assert.match(rollback, new RegExp(`grant execute on function public\\.${esc(signature)} to public, anon, authenticated;`, "i"));
  }
  assert.equal((rollback.match(/^alter function public\./gm) ?? []).length, 21);
  assert.equal((rollback.match(/^grant execute on function public\./gm) ?? []).length, 21);
  assert.doesNotMatch(rollback, /^(?:grant|revoke)[^;]*service_role|drop\s+function|alter\s+table/im);
});
