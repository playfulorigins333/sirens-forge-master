import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { computePriorityForTier, toCreatorComputeStatus } from "../../../lib/compute-jobs";
const read = (path: string) => fs.readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260825090000_durable_compute_job_plane.sql");

test("durable gate is server-only, exact true, and defaults off", () => {
  const source = read("lib/compute-jobs.ts");
  assert.match(source, /DURABLE_COMPUTE_JOBS_ENABLED === "true"/);
  assert.doesNotMatch(read(".env.example"), /NEXT_PUBLIC_DURABLE/);
  assert.match(read(".env.example"), /DURABLE_COMPUTE_JOBS_ENABLED=false/);
});

test("compute priority uses only the exact authoritative subscription tier", () => {
  assert.equal(computePriorityForTier("og_throne"), "og");
  assert.equal(computePriorityForTier("early_bird"), "standard");
  assert.equal(computePriorityForTier(null), "standard");
  assert.equal(computePriorityForTier("unknown_og"), "standard");
  const image = read("app/api/generate/route.ts");
  const trainer = read("app/api/lora/train/route.ts");
  assert.match(image, /computePriorityForTier\(auth\.subscription\?\.tier_name\)/);
  assert.match(trainer, /computePriorityForTier\(auth\.subscription\?\.tier_name\)/);
  assert.doesNotMatch(`${image}\n${trainer}`, /computePriorityForTier\(auth\.profile|priorityClass:.*badge/);
});

test("compute privileges are narrow and fake processing remains absent", () => {
  assert.doesNotMatch(migration, /ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+public/i);
  assert.match(migration, /revoke all on table public\.compute_jobs,[\s\S]*compute_spend_threshold_events from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(migration, /grant all on/i);
  assert.equal(fs.existsSync("lib/generation-jobs.ts"), false);
  for (const root of ["lib", "app", "components"]) for (const file of walk(root)) assert.doesNotMatch(read(file), /placehold\.co|sample-videos\.com|simulateProcessing/);
});

test("durable image validation is metadata-only and legacy resolver remains after the durable return", () => {
  const source = read("app/api/generate/route.ts");
  const durableStart = source.indexOf("if (durableComputeEnabled)");
  const durableReturn = source.indexOf("return NextResponse.json(toCreatorComputeStatus(job), { status: 202 })", durableStart);
  const legacyResolver = source.indexOf("resolveLoraStack(bodyMode, identityLora, userId)");
  assert.ok(durableStart >= 0 && durableReturn > durableStart && legacyResolver > durableReturn);
  assert.match(source.slice(durableStart, durableReturn), /resolveOwnedIdentityLoraMetadata/);
  assert.doesNotMatch(source.slice(durableStart, durableReturn), /buildWorkflow|resolveLoraStack|sirensApiFetch|BIGLUST|checkpoint|provider/);
  assert.match(source.slice(legacyResolver), /buildWorkflow/);
});

test("idempotency keys are validated rather than truncated", () => {
  const source = read("lib/compute-jobs.ts");
  assert.match(source, /key\.length < 1 \|\| key\.length > 128/);
  assert.doesNotMatch(source, /\.slice\(0,\s*128\)/);
});

test("creator result and error projection strips poisoned internal data", () => {
  const projected = toCreatorComputeStatus({ job_id: "j", workload: "image", creator_status: "completed", result_reference: {
    generation_id: "30000000-0000-4000-8000-000000000001", provider_operation_ref: "secret", worker_ref: "secret", lease_token: "secret", provider: "secret", model: "secret", cost: 99,
  }, safe_error_code: "provider said secret" });
  assert.deepEqual(projected.result_reference, { generation_id: "30000000-0000-4000-8000-000000000001" });
  assert.equal(projected.safe_error_code, null);
  for (const key of ["provider_operation_ref", "worker_ref", "lease_token", "provider", "model", "cost"]) assert.equal(JSON.stringify(projected).includes(key), false);
});

test("migration exposes bounded heartbeat, retry, recovery and exact-cost contracts", () => {
  for (const token of ["heartbeat_compute_job", "begin_compute_provider_dispatch", "retry_compute_pre_dispatch", "reconcile_compute_recovery", "release_compute_reservation", "recovery_token", "compute_cost_one_reservation_idx", "compute_cost_one_release_idx", "compute_cost_one_actual_idx", "compute_jobs_one_active_owner_workload_idx", "PROVIDER_NONEXECUTION_EVIDENCE_REQUIRED"]) assert.ok(migration.includes(token), token);
  assert.match(migration, /compute_jobs set lease_expires_at=renewed/);
  assert.match(migration, /compute_job_attempts set heartbeat_at=now\(\),lease_expires_at=renewed/);
});

test("video stays unavailable and durable client tracks a submitted job immediately", () => {
  assert.match(read("app/api/generate_video/route.ts"), /VIDEO_GENERATION_UNAVAILABLE/);
  const client = read("app/generate/page.tsx");
  assert.match(client, /activeComputeJobIds/);
  assert.match(client, /sirensforge:active-compute-jobs/);
  assert.match(client, /new Set\(\[\.\.\.ids, data\.job_id\]\)/);
  assert.match(client, /ids\.filter\(\(id\) => !terminalIds\.includes\(id\)\)/);
  assert.match(client, /\["completed", "failed", "cancelled"\]\.includes\(job\.status\)/);
  assert.match(client, /pendingSubmissionKey\("sirensforge:pending-image-compute"/);
  assert.doesNotMatch(client, /"Idempotency-Key": crypto\.randomUUID\(\)/);
  const trainer = read("app/lora/train/TrainPageClient.tsx");
  assert.match(trainer, /pendingSubmissionKey\("sirensforge:pending-trainer-compute"/);
  assert.match(trainer, /"Idempotency-Key": submissionKey/);
  assert.match(client, /batch: runCount/);
});

test("trainer status guards legacy text IDs and requires current-execution artifact evidence", () => {
  const source = read("app/api/lora/status/route.ts");
  assert.match(source, /durableTrainingJobId/);
  assert.match(source, /new Date\(data\.completed_at\) >= new Date\(compute\.queued_at\)/);
  assert.doesNotMatch(source, /p_job_id: data\.training_job_id/);
  const fixture = read("backend/compute/tests/computeJobPlanePostgresSetup.sql");
  assert.match(fixture, /training_job_id text/);
  assert.match(fixture, /create type public\.lora_status as enum \('idle','queued','training','completed','failed','draft'\)/);
});

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.name.startsWith(".") ? [] : entry.isDirectory() ? walk(`${dir}/${entry.name}`) : /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [`${dir}/${entry.name}`] : []);
}
