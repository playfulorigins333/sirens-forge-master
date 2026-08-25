import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { toCreatorComputeStatus } from "../../../lib/compute-jobs";
const read = (path: string) => fs.readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260825090000_durable_compute_job_plane.sql");

test("durable gate is server-only, exact true, and defaults off", () => {
  const source = read("lib/compute-jobs.ts");
  assert.match(source, /DURABLE_COMPUTE_JOBS_ENABLED === "true"/);
  assert.doesNotMatch(read(".env.example"), /NEXT_PUBLIC_DURABLE/);
  assert.match(read(".env.example"), /DURABLE_COMPUTE_JOBS_ENABLED=false/);
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
  for (const token of ["heartbeat_compute_job", "retry_compute_pre_dispatch", "reconcile_compute_recovery", "recovery_token", "compute_cost_one_reservation_idx", "compute_cost_one_release_idx", "compute_cost_one_actual_idx", "compute_jobs_one_active_owner_workload_idx", "PROVIDER_NONEXECUTION_EVIDENCE_REQUIRED"]) assert.ok(migration.includes(token), token);
  assert.match(migration, /compute_jobs set lease_expires_at=renewed/);
  assert.match(migration, /compute_job_attempts set heartbeat_at=now\(\),lease_expires_at=renewed/);
});

test("video stays unavailable and durable client tracks a submitted job immediately", () => {
  assert.match(read("app/api/generate_video/route.ts"), /VIDEO_GENERATION_UNAVAILABLE/);
  const client = read("app/generate/page.tsx");
  assert.match(client, /setActiveComputeJobId\(data\.job_id\)/);
  assert.match(client, /\[durableCompute, activeComputeJobId\]/);
  assert.match(client, /batch: runCount/);
});

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.name.startsWith(".") ? [] : entry.isDirectory() ? walk(`${dir}/${entry.name}`) : /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [`${dir}/${entry.name}`] : []);
}
