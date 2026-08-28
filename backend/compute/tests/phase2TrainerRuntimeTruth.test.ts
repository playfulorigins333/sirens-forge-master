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

test("creator state projection rejects orphan activity and artifactless completion", () => {
  for (const status of ["queued", "training"]) {
    const projected = projectTrainerState({ status });
    assert.equal(projected.status, "failed");
    assert.equal(projected.error_message, TRAINER_STATE_ORPHANED);
  }
  assert.equal(projectTrainerState({ status: "queued", training_job_id: jobId }).status, "queued");
  assert.equal(projectTrainerState({ status: "training", training_job_id: jobId }).status, "training");
  assert.equal(projectTrainerState({ status: "completed", artifact_r2_bucket: "models", artifact_r2_key: "loras/old/final.safetensors" }).status, "completed");
  const artifactless = projectTrainerState({ status: "completed" });
  assert.equal(artifactless.status, "failed");
  assert.equal(artifactless.error_message, TRAINER_STATE_ORPHANED);
});

test("all creator surfaces use the same truth projection", () => {
  for (const path of ["app/api/lora/status/route.ts", "app/identities/page.tsx", "app/identities/[id]/page.tsx"]) {
    assert.match(read(path), /projectTrainerState/);
  }
  const status = read("app/api/lora/status/route.ts");
  assert.match(status, /creator_compute_status/);
  assert.match(status, /TRAINER_STATE_ORPHANED/);
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
  assert.match(migration, /identity_id.*l\.id::text/);
  assert.match(migration, /TRAINER_STATE_ORPHANED/);
  assert.doesNotMatch(migration, /delete|truncate|drop/i);
});
