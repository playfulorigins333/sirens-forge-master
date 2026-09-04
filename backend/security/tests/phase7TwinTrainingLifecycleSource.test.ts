import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");

const migration = read("supabase/migrations/20260904223000_phase7_twin_training_lifecycle.sql");
const race = read("supabase/migrations/20260904223100_phase7_twin_training_lifecycle_race_hardening.sql");
const readBoundary = read("supabase/migrations/20260904223200_phase7_twin_active_read_boundary.sql");
const service = read("lib/twin-lifecycle.ts");
const identities = read("app/api/generate/identities/route.ts");
const metadata = read("lib/generation/identityLoraMetadata.ts");
const uploads = read("app/api/lora/get-upload-urls/route.ts");
const manage = read("app/library/manage/twins/ManageTwinsClient.tsx");
const deleted = read("app/library/recently-deleted/twins/RecentlyDeletedTwinsClient.tsx");

test("Twin and training-data lifecycle are independent durable states", () => {
  assert.match(migration, /lifecycle_state text not null default 'active'/);
  assert.match(migration, /training_data_state text not null default 'active'/);
  assert.match(migration, /clock_timestamp\(\)\+interval '30 days'/);
  assert.match(migration, /training_data_state='purged'/);
  assert.match(migration, /artifact_r2_bucket=null,artifact_r2_key=null,trigger_token=null/);
  assert.match(migration, /delete from public\.dataset_doctor_images/);
  assert.match(migration, /delete from public\.dataset_doctor_selections/);
  assert.match(migration, /TWIN_PURGE_BLOCKED_ACTIVE_TRAINER/);
  assert.match(migration, /TWIN_PURGE_BLOCKED_ACTIVE_COMPUTE/);
  assert.match(migration, /interval '11 minutes'/);
  assert.match(race, /TWIN_TRAINING_DATA_PURGE_ALREADY_CLAIMED/);
});

test("new-use gates fail closed for non-active Twins", () => {
  assert.match(migration, /phase7_assert_twin_new_use/);
  assert.match(migration, /before insert on public\.dataset_doctor_jobs/);
  assert.match(migration, /before insert on public\.video_projects/);
  assert.match(migration, /before insert on public\.compute_jobs/);
  assert.match(readBoundary, /as restrictive/);
  assert.match(readBoundary, /using \(lifecycle_state='active'\)/);
  assert.match(identities, /\.eq\("lifecycle_state", "active"\)/);
  assert.match(metadata, /\.eq\("lifecycle_state", "active"\)/);
  assert.match(uploads, /lifecycle_state,training_data_state/);
  assert.match(uploads, /reactivateTwinTrainingData/);
});

test("physical purge uses only the internal Railway Twin storage authority", () => {
  assert.match(service, /sirensApiFetch\("\/internal\/twin-storage\/purge"/);
  assert.match(service, /JSON\.stringify\(\{ twin_id: twinId, scope \}\)/);
  assert.doesNotMatch(service, /R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|deleteObject|DeleteObjectCommand/);
  assert.match(service, /claim_user_lora_training_data_purge/);
  assert.match(service, /finalize_user_lora_training_data_purge/);
  assert.match(service, /claim_user_lora_purge/);
  assert.match(service, /finalize_user_lora_purge/);
});

test("creator-facing copy preserves locked product semantics", () => {
  assert.match(manage, /does NOT delete the trained Twin/i);
  assert.match(manage, /30-day recovery window/i);
  assert.match(deleted, /Existing media already generated with it will remain/i);
  assert.match(deleted, /Phase 8 scheduler responsibility/i);
});
