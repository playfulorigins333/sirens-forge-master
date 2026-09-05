import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/20260905070000_phase8_generation_training_data_minimization.sql", "utf8");

test("Phase 8B preserves canonical creator data and only minimizes duplicate/transient copies", () => {
  assert.match(migration, /canonical generations\.prompt/i);
  assert.match(migration, /does NOT purge creator media/i);
  assert.doesNotMatch(migration, /update\s+public\.generations[\s\S]*set\s+prompt\s*=/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.generations/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.user_loras/i);
});

test("terminal compute jobs are minimized and cannot silently regain private request fields", () => {
  assert.match(migration, /zz_phase8_minimize_terminal_compute_payload/);
  assert.match(migration, /phase8_guard_terminal_compute_payload_update/);
  for (const privateKey of ["prompt", "negative_prompt", "identity_reference", "dataset_reference", "dataset_snapshot", "dataset_selection"]) {
    const trainerReturn = migration.match(/if p_workload='trainer'[\s\S]*?elsif p_workload='image'/i)?.[0] || "";
    if (["dataset_snapshot", "dataset_selection", "dataset_reference"].includes(privateKey)) assert.doesNotMatch(trainerReturn, new RegExp(`'${privateKey}'`));
  }
  const imageReturn = migration.match(/elsif p_workload='image'[\s\S]*?elsif p_workload='video'/i)?.[0] || "";
  assert.doesNotMatch(imageReturn, /'prompt'|'negative_prompt'|'identity_reference'/);
});

test("legal holds block Phase 8B minimization", () => {
  assert.match(migration, /governance_target_has_active_legal_hold\('compute_job',new\.id::text,new\.owner_id\)/);
  assert.match(migration, /governance_target_has_active_legal_hold\('generation',g\.id::text,g\.user_id\)/);
});

test("generation metadata strips duplicate private content keys", () => {
  for (const key of ["prompt", "raw_prompt", "negative_prompt", "caption", "content", "identity_lora", "request", "workflow_json", "image_base64", "file_bytes"]) {
    assert.match(migration, new RegExp(`'${key}'`));
  }
});
