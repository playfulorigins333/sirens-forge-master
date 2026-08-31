import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { computePriorityForTier, toCreatorComputeStatus } from "../../../lib/compute-jobs";
const read = (path: string) => fs.readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260825090000_durable_compute_job_plane.sql");
const pass4a = read("supabase/migrations/20260826004344_durable_compute_pass_4a_finalization.sql");
const pass4c = read("supabase/migrations/20260826120000_durable_compute_pass_4c_video_stitch_foundation.sql");

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
  assert.match(source.slice(durableStart, durableReturn), /buildDurableIdentityReference/);
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

test("migration exposes bounded heartbeat, worker signal, recovery leases and exact-cost contracts", () => {
  for (const token of ["heartbeat_compute_job", "compute_worker_signal", "begin_compute_provider_dispatch", "retry_compute_pre_dispatch", "claim_compute_recovery", "heartbeat_compute_recovery", "compute_recovery_signal", "reconcile_compute_recovery", "release_compute_reservation", "recovery_token", "recovery_lease_token", "recovery_worker_ref", "recovery_heartbeat_at", "recovery_lease_expires_at", "compute_cost_one_reservation_idx", "compute_cost_one_release_idx", "compute_cost_one_actual_idx", "compute_jobs_one_active_owner_workload_idx", "PROVIDER_NONEXECUTION_EVIDENCE_REQUIRED"]) assert.ok(migration.includes(token), token);
  assert.match(migration, /compute_jobs set lease_expires_at=renewed/);
  assert.match(migration, /compute_job_attempts set heartbeat_at=now\(\),lease_expires_at=renewed/);
  assert.match(migration, /returns table\(job_state public\.compute_job_state,cancellation_requested boolean\)/);
  assert.match(migration, /recovery_lease_token=null,recovery_worker_ref=null,recovery_heartbeat_at=null,recovery_lease_expires_at=null/);
  assert.match(migration, /grant execute on function[\s\S]*compute_worker_signal\(uuid,uuid,uuid\)[\s\S]*claim_compute_recovery\(public\.compute_workload,text\)[\s\S]*heartbeat_compute_recovery\(uuid,uuid,uuid\)[\s\S]*to service_role/);
  assert.match(migration, /create function public\.compute_recovery_signal\(p_job_id uuid,p_attempt_id uuid,p_recovery_lease_token uuid\)[\s\S]*returns table\(job_state public\.compute_job_state,cancellation_requested boolean\)/);
  assert.match(migration, /revoke all on function[\s\S]*compute_recovery_signal\(uuid,uuid,uuid\)[\s\S]*from public,anon,authenticated/);
  assert.match(migration, /grant execute on function[\s\S]*compute_recovery_signal\(uuid,uuid,uuid\)[\s\S]*to service_role/);
});

test("merge-blocker dispatch, recovery, result, Stitch, and Image conflict guards remain explicit", () => {
  assert.match(migration, /a\.provider_dispatch_intent_at is not null or a\.provider_dispatched_at is not null/);
  assert.match(migration, /recovery_fingerprint=fingerprint,recovery_state=final_state/);
  assert.match(migration, /if a\.recovery_fingerprint=fingerprint then return a\.recovery_state/);
  assert.match(migration, /select \* into a from public\.compute_job_attempts[\s\S]*a\.lease_token<>p_lease_token[\s\S]*TERMINAL_TRANSITION_CONFLICT/);
  assert.match(migration, /jsonb_array_elements\(p_result->'asset_ids'\)[\s\S]*jsonb_typeof\(item\)<>'string'/);
  assert.match(migration, /q\.workload in \('trainer','image','video'\) and q\.priority_class='og'/);
  assert.match(read("app/api/generate/route.ts"), /message\.includes\("IDEMPOTENCY_CONFLICT"\)[\s\S]*status: 409/);
});

test("durable Video application and client track submitted work immediately", () => {
  assert.throws(() => read("app/api/generate_video/route.ts"));
  assert.match(read("app/api/video/route.ts"), /submitVideoProject/);
  const client = read("app/generate/page.tsx");
  assert.match(client, /activeComputeJobIds/);
  assert.match(client, /sirensforge:active-compute-jobs/);
  assert.match(client, /new Set\(\[\.\.\.ids, canonicalJobId\]\)/);
  assert.match(client, /const canonicalJobId = canonicalComputeJobId\(data\?\.job_id\)/);
  assert.match(client, /ids\.filter\(\(id\) => !terminalIds\.includes\(id\)\)/);
  assert.match(client, /job\.status === "completed"/);
  assert.match(client, /job\.status === "failed"/);
  assert.match(client, /job\.status === "cancelled"/);
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
  const projection = read("lib/lora/trainer-state.ts");
  assert.match(projection, /completedAt >= queuedAt/);
  assert.match(projection, /isExactTrainerBinding/);
  assert.match(source, /\.eq\("owner_id", userId\)/);
  assert.match(source, /\.eq\("workload", "trainer"\)/);
  assert.doesNotMatch(source, /p_job_id: data\.training_job_id/);
  const fixture = read("backend/compute/tests/computeJobPlanePostgresSetup.sql");
  assert.match(fixture, /training_job_id text/);
  assert.match(fixture, /create type public\.lora_status as enum \('idle','queued','training','completed','failed','draft'\)/);
});

test("Pass 4A atomically finalizes workload products and blocks generic success", () => {
  for (const fn of ["finalize_image_compute_job", "finalize_recovered_image_compute_job", "finalize_trainer_compute_job", "finalize_recovered_trainer_compute_job"]) assert.ok(pass4a.includes(fn), fn);
  assert.match(pass4a, /WORKLOAD_FINALIZATION_REQUIRED/);
  assert.match(pass4a, /p_action='success' and j\.workload in \('image','trainer'\)/);
  assert.match(pass4a, /p_outcome='succeeded' and j\.workload in \('image','trainer'\)/);
  assert.doesNotMatch(pass4a, /current_setting|set_config/);
  assert.match(pass4a, /finalize_private_generation\(p_job\.id,p_job\.owner_id,generation_data,normalized\)/);
  assert.match(pass4a, /expected_prefix:='creator-generations\/'\|\|p_job\.id::text\|\|'\/'/);
  assert.match(pass4a, /token:='sf'\|\|lower\(substr\(replace\(lora_id::text,'-',''\),1,8\)\)/);
  assert.match(pass4a, /result:=jsonb_build_object\('result_id',lora_id\)/);
  assert.match(pass4a, /DURABLE_IMAGE_GENERATION_CONFLICT/);
  assert.match(pass4a, /a\.ordinal<>j\.attempt_count/);
  assert.match(pass4a, /a\.finished_at is null or a\.outcome_class<>'succeeded'/);
  assert.match(pass4a, /revoke all on function public\.project_trainer_compute_state\(\)/);
  assert.match(pass4a, /from public,anon,authenticated,service_role;[\s\S]*grant execute on function[\s\S]*to service_role/);
  assert.doesNotMatch(pass4a, /grant (select|insert|update|delete|all).*compute_/i);
});

test("Pass 4A serializes same-Twin submission and projects only the exact binding", () => {
  assert.match(pass4a, /where id=p_lora_id and user_id=p_owner_id for update/);
  assert.match(pass4a, /current_job\.state not in \('succeeded','failed','cancelled'\).*TRAINER_ALREADY_ACTIVE/);
  assert.match(pass4a, /training_job_id=new\.id::text/);
  assert.doesNotMatch(pass4a, /new\.state = 'succeeded'[\s\S]{0,300}status='completed'/);
  assert.match(read("app/api/lora/train/route.ts"), /TRAINER_ALREADY_ACTIVE[\s\S]*status: 409/);
});

test("Pass 4A PostgreSQL integration runs in CI against a separate database", () => {
  const workflow = read(".github/workflows/compute-job-plane-postgres.yml");
  assert.match(workflow, /create database compute_job_plane_test/);
  assert.match(workflow, /create database compute_job_plane_pass4a_test/);
  assert.match(workflow, /COMPUTE_JOB_PLANE_DATABASE_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/compute_job_plane_pass4a_test/);
  assert.match(workflow, /npm run test:compute-job-plane-pass4a-postgres/);
});

test("Pass 4C-A establishes a private Video Project and dependent Stitch contract", () => {
  for (const token of ["video_projects", "video_project_segments", "submit_video_project_compute_jobs", "video_compute_manifest", "recovered_video_compute_manifest", "stitch_compute_manifest", "recovered_stitch_compute_manifest", "finalize_video_compute_job", "finalize_recovered_video_compute_job", "finalize_stitch_compute_job", "finalize_recovered_stitch_compute_job", "creator_video_project_status", "cancel_video_project"]) assert.ok(pass4c.includes(token), token);
  assert.match(pass4c, /priority_class='standard'[\s\S]*requested_duration_seconds between 10 and 15[\s\S]*segment_count=2/);
  assert.match(pass4c, /priority_class='og'[\s\S]*requested_duration_seconds between 20 and 25[\s\S]*segment_count=3/);
  assert.match(pass4c, /target_fps=30/); assert.match(pass4c, /target_min_short_edge>=1080/);
  assert.match(pass4c, /mime_type in \('image\/jpeg','image\/png','image\/webp','video\/mp4'\)/);
  assert.match(pass4c, /WORKLOAD_SUBMISSION_REQUIRED/);
  assert.match(pass4c, /j\.workload in \('image','trainer','video','stitch'\)/);
  assert.match(pass4c, /p_outcome='succeeded' and j\.workload in \('image','trainer','video','stitch'\)/);
  assert.match(pass4c, /alter table public\.video_projects force row level security/);
  assert.match(pass4c, /revoke all on table public\.video_projects,public\.video_project_segments from public,anon,authenticated,service_role/);
  assert.doesNotMatch(pass4c, /grant (select|insert|update|delete|all).*video_project/i);
  assert.doesNotMatch(pass4c, /https?:\/\/|signed_url.*jsonb_build_object|runpod\.ai|comfy|ffmpeg/i);
});

test("Phase 4 activates only the dedicated Video project path while generic helpers fail closed", async () => {
  const helper = read("lib/compute-jobs.ts");
  assert.match(helper, /args\.workload === "video" \|\| args\.workload === "stitch"/);
  assert.throws(() => read("app/api/generate_video/route.ts"));
  assert.match(read("app/api/video/route.ts"), /isVideoSubmissionReady/);
  assert.match(read("lib/video/submission.ts"), /submit_video_project_compute_jobs/);
  assert.doesNotMatch(read("app/generate/page.tsx"), /Video · Coming Soon/);
});

test("Pass 4C-A PostgreSQL integration has a third isolated CI database", () => {
 const workflow=read(".github/workflows/compute-job-plane-postgres.yml");
 assert.match(workflow,/create database compute_job_plane_pass4c_test/);
 assert.match(workflow,/npm run test:compute-job-plane-pass4c-postgres/);
});

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.name.startsWith(".") ? [] : entry.isDirectory() ? walk(`${dir}/${entry.name}`) : /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [`${dir}/${entry.name}`] : []);
}
