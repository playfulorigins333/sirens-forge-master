import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationPath =
  "supabase/migrations/20260717001600_remove_broad_lora_storage_upload_policy.sql";
const assertionsPath =
  "backend/creator-publishing-queue/tests/task19StoragePolicyRemediationPostgresIntegration.sql";
const runnerPath =
  "backend/creator-publishing-queue/tests/runTask19StoragePolicyRemediationPostgresIntegration.mjs";

test("forward migration drops only the exact obsolete production policy", () => {
  const sql = readFileSync(migrationPath, "utf8")
    .replace(/\r\n/g, "\n")
    .trimEnd();
  const expected = [
    "drop policy if exists",
    '  "authenticated users can upload lora datasets lk1r3q_0"',
    "on storage.objects;",
  ].join("\n");

  assert.equal(sql, expected);

  assert.doesNotMatch(sql, /\bcreate\s+policy\b/i);
  assert.doesNotMatch(sql, /\balter\s+policy\b/i);
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
  assert.doesNotMatch(sql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(sql, /\bdrop\s+schema\b/i);
  assert.doesNotMatch(sql, /\bdrop\s+bucket\b/i);
  assert.doesNotMatch(sql, /\binsert\b|\bupdate\b|\btruncate\b/i);
  assert.doesNotMatch(sql, /\bgrant\b|\brevoke\b/i);
  assert.doesNotMatch(sql, /\bstorage\.buckets\b/i);
  assert.doesNotMatch(sql, /\blora-datasets\b/i);
});

test("active LoRA upload and training paths remain R2-only", () => {
  const client = readFileSync("app/lora/train/TrainPageClient.tsx", "utf8");
  const uploadUrlsRoute = readFileSync(
    "app/api/lora/get-upload-urls/route.ts",
    "utf8",
  );
  const uploadDatasetRoute = readFileSync(
    "app/api/lora/upload-dataset/route.ts",
    "utf8",
  );
  const worker = readFileSync("runpod/train_lora.py", "utf8");

  assert.match(client, /fetch\("\/api\/lora\/get-upload-urls"/);
  assert.match(client, /R2 upload URL count mismatch/);
  assert.doesNotMatch(client, /supabase\.storage|lora-datasets/i);

  assert.match(uploadUrlsRoute, /@aws-sdk\/s3-request-presigner/);
  assert.match(uploadUrlsRoute, /requireUserId/);
  assert.match(uploadUrlsRoute, /lora\.user_id !== userId/);
  assert.match(uploadUrlsRoute, /dataset_doctor\/\$\{loraId\}\/raw/);
  assert.doesNotMatch(
    uploadUrlsRoute,
    /\.storage\.from\(|createSignedUploadUrl|lora-datasets/i,
  );

  assert.match(uploadDatasetRoute, /S3Client/);
  assert.match(uploadDatasetRoute, /R2_BUCKET/);
  assert.match(uploadDatasetRoute, /lora_datasets/);
  assert.doesNotMatch(
    uploadDatasetRoute,
    /supabase\.storage|\.storage\.from\(|lora-datasets/i,
  );

  assert.match(worker, /R2 STORAGE/);
  assert.match(worker, /lora_datasets\/<lora_id>/);
  assert.match(worker, /loras\/<lora_id>\/final\.safetensors/);
  assert.doesNotMatch(worker, /storage\/v1|lora-datasets/i);
});

test("isolated PostgreSQL runner is fail-closed and uses temporary diagnostics", () => {
  const runner = readFileSync(runnerPath, "utf8");

  assert.match(runner, /process\.env\.TASK19_STORAGE_TEST_DATABASE_URL/);
  assert.doesNotMatch(runner, /process\.env\.DATABASE_URL/);
  assert.match(runner, /new Set\(\["postgres:", "postgresql:"\]\)/);
  assert.match(
    runner,
    /new Set\(\["127\.0\.0\.1", "localhost", "\[::1\]"\]\)/,
  );
  assert.match(runner, /parsedUrl\.port !== "5432"/);
  assert.match(
    runner,
    /parsedUrl\.pathname !== "\/task19_storage_policy_test"/,
  );
  assert.match(runner, /parsedUrl\.search !== ""/);
  assert.match(runner, /parsedUrl\.hash !== ""/);

  assert.match(runner, /const tempDirectory = mkdtempSync\(/);
  assert.match(
    runner,
    /const logPath = join\(tempDirectory, "task19-storage-policy-postgres-diagnostics\.log"\);/,
  );
  assert.doesNotMatch(
    runner,
    /const logPath = "task19-storage-policy-postgres-diagnostics\.log"/,
  );

  assert.match(runner, /create or replace function auth\.role\(\)/);
  assert.match(
    runner,
    /current_setting\('request\.jwt\.claim\.role', true\)/,
  );
  assert.match(
    runner,
    /with check \(\(auth\.role\(\) = 'authenticated'::text\)\);/,
  );
  assert.match(
    runner,
    /expected broad policy fixture is missing before migration/,
  );
});

test("isolated assertions prove authenticated INSERT is rejected after removal", () => {
  const assertions = readFileSync(assertionsPath, "utf8");

  assert.match(
    assertions,
    /cmd = 'INSERT'[\s\S]*'no INSERT policy remains on storage\.objects'/,
  );
  assert.match(
    assertions,
    /has_table_privilege\('authenticated', 'storage\.objects', 'INSERT'\)/,
  );
  assert.match(
    assertions,
    /has_schema_privilege\('authenticated', 'storage', 'USAGE'\)/,
  );
  assert.match(assertions, /set local role authenticated;/);
  assert.match(
    assertions,
    /set_config\(\s*'request\.jwt\.claim\.role',\s*'authenticated',\s*true\s*\)/,
  );
  assert.match(assertions, /insert into storage\.objects/);
  assert.match(assertions, /when insufficient_privilege then/);
  assert.match(assertions, /row-level security policy/);
  assert.match(assertions, /reset role;/);
});
