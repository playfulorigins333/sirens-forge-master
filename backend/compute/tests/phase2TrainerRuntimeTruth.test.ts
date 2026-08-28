import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectTrainerState, TRAINER_STATE_ORPHANED } from "../../../lib/lora/trainer-state";

const read = (path: string) => readFileSync(path, "utf8");
const jobId = "10000000-0000-4000-8000-000000000001";

test("Trainer submission fails closed and only durable RPC output can queue", () => {
  const source = read("app/api/lora/train/route.ts");
  assert.match(source, /!isDurableComputeJobsEnabled\(\)[\s\S]*TRAINER_EXECUTION_UNAVAILABLE[\s\S]*status: 503/);
  assert.match(source, /COMPUTE_POLICY_UNCONFIGURED[\s\S]*TRAINER_EXECUTION_UNAVAILABLE/);
  assert.match(source, /submit_trainer_compute_job/);
  assert.match(source, /creatorJob\?\.job_id/);
  assert.match(source, /canonicalUuid\(creatorJob\.job_id\)/);
  assert.doesNotMatch(source, /\.from\("user_loras"\)[\s\S]*\.update\([\s\S]*status:\s*["']queued["']/);
  assert.doesNotMatch(source, /TRAINER_EXECUTION_SELECTION_LIMIT/);
});

test("Dataset Doctor export is runtime-independent and direct queueing stays prohibited", () => {
  const source = read("lib/datasetDoctorProxy.ts");
  assert.doesNotMatch(source, /DURABLE_COMPUTE|trainerSelectionCapacity|TRAINER_EXECUTION_SELECTION_LIMIT/);
  assert.match(source, /body\.queue_training === true/);
  assert.match(source, /queue_training: false/);
});

test("creator projection requires the exact durable Trainer binding", () => {
  const twinId = "30000000-0000-4000-8000-000000000001";
  const otherTwinId = "30000000-0000-4000-8000-000000000002";
  const ownerId = "20000000-0000-4000-8000-000000000001";
  const otherOwnerId = "20000000-0000-4000-8000-000000000002";
  const row = { id: twinId, user_id: ownerId, status: "queued", training_job_id: jobId };
  const exact = { id: jobId, owner_id: ownerId, workload: "trainer", state: "queued", request_payload: { identity_id: twinId }, queued_at: "2026-08-28T08:00:00Z" };
  const orphan = (job?: any, source: any = row) => {
    const projected = projectTrainerState(source, job);
    assert.equal(projected.status, "failed");
    assert.equal(projected.error_message, TRAINER_STATE_ORPHANED);
  };

  orphan();
  orphan(null, { ...row, training_job_id: "not-a-uuid" });
  orphan(null, row); // syntactically valid but nonexistent
  for (const workload of ["image", "video", "stitch"]) orphan({ ...exact, workload });
  orphan({ ...exact, request_payload: { identity_id: otherTwinId } });
  orphan({ ...exact, owner_id: otherOwnerId });

  assert.equal(projectTrainerState(row, exact).status, "queued");
  for (const state of ["claimed", "running", "recovering", "cancel_requested"]) {
    assert.equal(projectTrainerState(row, { ...exact, state }).status, "training");
  }
  for (const state of ["failed", "cancelled"]) {
    assert.equal(projectTrainerState(row, { ...exact, state }).status, "failed");
  }

  const completed = { ...row, status: "training", completed_at: "2026-08-28T09:00:00Z", artifact_r2_bucket: "models", artifact_r2_key: "loras/final.safetensors" };
  assert.equal(projectTrainerState(completed, { ...exact, state: "succeeded" }).status, "completed");
  orphan({ ...exact, state: "succeeded" }, { ...completed, artifact_r2_key: " " });
  orphan({ ...exact, state: "succeeded" }, { ...completed, completed_at: "2026-08-28T07:00:00Z" });
  assert.equal(projectTrainerState({ ...completed, status: "completed", training_job_id: null }, null).status, "completed");
});

test("all creator surfaces retrieve and project exact durable bindings", () => {
  const list = read("app/identities/page.tsx");
  assert.match(list, /\.in\("id", canonicalJobIds\)/);
  assert.match(list, /\.eq\("owner_id", authUserId\)/);
  assert.match(list, /\.eq\("workload", "trainer"\)/);
  assert.match(list, /projectTrainerState\(rawLora, trainerJobsById/);

  const detail = read("app/identities/[id]/page.tsx");
  assert.match(detail, /\.eq\("owner_id", user\.id\)/);
  assert.match(detail, /\.eq\("workload", "trainer"\)/);
  assert.match(detail, /projectTrainerState\(identityRow, trainerJob\)/);

  const status = read("app/api/lora/status/route.ts");
  assert.match(status, /\.eq\("owner_id", userId\)/);
  assert.match(status, /\.eq\("workload", "trainer"\)/);
  assert.match(status, /projectTrainerState\(data, trainerJob\)/);
  assert.doesNotMatch(status, /creator_compute_status/);
});

test("Trainer UX preserves prepared review state when runtime is unavailable", () => {
  const source = read("app/lora/train/TrainPageClient.tsx");
  assert.match(source, /queueJson\?\.error === "TRAINER_EXECUTION_UNAVAILABLE"[\s\S]*setTrainingStatus\("review"\)/);
  assert.match(source, /queueJson\?\.job_id[\s\S]*queueJson\?\.status !== "queued"/);
  assert.match(source, /prepared dataset is preserved/);
});

test("cleanup migration is invariant-bound and idempotent", () => {
  const migration = read("supabase/migrations/20260828085501_repair_orphaned_trainer_states.sql");
  assert.match(migration, /status in \('queued', 'training'\)/);
  assert.match(migration, /j\.id::text = l\.training_job_id/);
  assert.match(migration, /j\.owner_id = l\.user_id/);
  assert.match(migration, /j\.workload = 'trainer'/);
  assert.match(migration, /j\.state in \('queued', 'claimed', 'running', 'recovering', 'cancel_requested'\)/);
  assert.match(migration, /identity_id.*l\.id::text/);
  assert.match(migration, /TRAINER_STATE_ORPHANED/);
  assert.doesNotMatch(migration, /delete|truncate|drop/i);
});
