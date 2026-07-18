import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationPath =
  "supabase/migrations/20260717001600_remove_broad_lora_storage_upload_policy.sql";
const assertionsPath =
  "backend/creator-publishing-queue/tests/task19StoragePolicyRemediationPostgresIntegration.sql";
const runnerPath =
  "backend/creator-publishing-queue/tests/runTask19StoragePolicyRemediationPostgresIntegration.mjs";

test("forward migration drops exactly the five obsolete production policies", () => {
  const sql = readFileSync(migrationPath, "utf8")
    .replace(/\r\n/g, "\n")
    .trimEnd();

  const expected = [
    "drop policy if exists",
    '  "authenticated users can upload lora datasets lk1r3q_0"',
    "on storage.objects;",
    "",
    "drop policy if exists",
    '  "allow anon uploads to lora-datasets"',
    "on storage.objects;",
    "",
    "drop policy if exists",
    '  "allow authenticated uploads to lora-datasets"',
    "on storage.objects;",
    "",
    "drop policy if exists",
    '  "sf_lora_datasets_insert_public"',
    "on storage.objects;",
    "",
    "drop policy if exists",
    '  "sf_lora_datasets_update_public"',
    "on storage.objects;",
  ].join("\n");

  assert.equal(sql, expected);

  assert.equal(
    (sql.match(/\bdrop\s+policy\s+if\s+exists\b/gi) ?? []).length,
    5,
  );

  assert.doesNotMatch(sql, /\bcreate\s+policy\b/i);
  assert.doesNotMatch(sql, /\balter\s+policy\b/i);
  assert.doesNotMatch(sql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(sql, /\bdrop\s+schema\b/i);
  assert.doesNotMatch(sql, /\bdrop\s+bucket\b/i);
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
  assert.doesNotMatch(sql, /\binsert\s+into\b/i);
  assert.doesNotMatch(sql, /\bupdate\s+storage\.objects\b/i);
  assert.doesNotMatch(sql, /\btruncate\b/i);
  assert.doesNotMatch(sql, /\bgrant\b|\brevoke\b/i);
  assert.doesNotMatch(sql, /\bstorage\.buckets\b/i);
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

test("isolated PostgreSQL runner is fail-closed and local-only", () => {
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
    /"task19-storage-policy-postgres-diagnostics\.log"/,
  );
  assert.doesNotMatch(
    runner,
    /const logPath = "task19-storage-policy-postgres-diagnostics\.log"/,
  );
});

test("isolated fixture reproduces the five captured production policies", () => {
  const runner = readFileSync(runnerPath, "utf8");

  assert.match(runner, /create or replace function auth\.role\(\)/);
  assert.match(runner, /create or replace function auth\.uid\(\)/);

  assert.match(
    runner,
    /"allow anon uploads to lora-datasets"[\s\S]*for insert[\s\S]*to anon[\s\S]*with check \(\(bucket_id = 'lora-datasets'::text\)\);/,
  );

  assert.match(
    runner,
    /"allow authenticated uploads to lora-datasets"[\s\S]*for insert[\s\S]*to authenticated[\s\S]*with check \(\(bucket_id = 'lora-datasets'::text\)\);/,
  );

  assert.match(
    runner,
    /"authenticated users can upload lora datasets lk1r3q_0"[\s\S]*for insert[\s\S]*to authenticated[\s\S]*with check \(\(auth\.role\(\) = 'authenticated'::text\)\);/,
  );

  assert.match(
    runner,
    /"sf_lora_datasets_insert_public"[\s\S]*for insert[\s\S]*to public[\s\S]*owner is null[\s\S]*owner = auth\.uid\(\)/,
  );

  assert.match(
    runner,
    /"sf_lora_datasets_update_public"[\s\S]*for update[\s\S]*to public[\s\S]*using \([\s\S]*owner is null[\s\S]*with check \([\s\S]*owner = auth\.uid\(\)/,
  );

  assert.match(
    runner,
    /with_check =\s*'\(\(bucket_id = ''lora-datasets''::text\) AND \(name ~~ ''lora_datasets\/%''::text\) AND \(\(owner IS NULL\) OR \(owner = auth\.uid\(\)\)\)\)'/,
  );

  assert.match(
    runner,
    /qual =[\s\S]*name ~~ ''lora_datasets\/%''::text[\s\S]*owner IS NULL/,
  );

  assert.match(
    runner,
    /expected nine-policy fixture is incomplete/,
  );
});

test("isolated fixture preserves representative unrelated policies", () => {
  const runner = readFileSync(runnerPath, "utf8");

  assert.match(runner, /"service role can read lora datasets"/);
  assert.match(runner, /"service role can upload lora datasets"/);
  assert.match(runner, /"service role full access to jobs"/);
  assert.match(runner, /"users can read own job outputs"/);

  assert.match(runner, /create temporary table task19_buckets_before/);
  assert.match(runner, /create temporary table task19_objects_before/);
  assert.match(runner, /create temporary table task19_objects_acl_before/);

  assert.match(
    runner,
    /grant usage on schema storage to anon, authenticated, service_role;/,
  );
  assert.match(
    runner,
    /grant select, insert, update on storage\.objects to anon, authenticated;/,
  );
});

test("runner applies migration twice to prove idempotency", () => {
  const runner = readFileSync(runnerPath, "utf8");

  assert.match(
    runner,
    /Applying remediation migration for the first time/,
  );
  assert.match(
    runner,
    /Applying remediation migration for the second time/,
  );

  assert.match(
    runner,
    /bootstrap,\s*migration,\s*assertions,\s*repeat,\s*migration,\s*assertions,\s*finish/,
  );
});

test("PostgreSQL assertions prove complete removal without collateral changes", () => {
  const assertions = readFileSync(assertionsPath, "utf8");

  assert.match(
    assertions,
    /authenticated users can upload lora datasets lk1r3q_0/,
  );
  assert.match(assertions, /allow anon uploads to lora-datasets/);
  assert.match(
    assertions,
    /allow authenticated uploads to lora-datasets/,
  );
  assert.match(assertions, /sf_lora_datasets_insert_public/);
  assert.match(assertions, /sf_lora_datasets_update_public/);

  assert.match(
    assertions,
    /all five obsolete LoRA Storage write policies were removed/,
  );
  assert.match(
    assertions,
    /only the four unrelated Storage policies remain/,
  );

  assert.match(
    assertions,
    /service-role LoRA read policy remains unchanged/,
  );
  assert.match(
    assertions,
    /service-role LoRA upload policy remains unchanged/,
  );
  assert.match(
    assertions,
    /service-role jobs policy remains unchanged/,
  );
  assert.match(
    assertions,
    /authenticated jobs read policy remains unchanged/,
  );

  assert.match(
    assertions,
    /storage\.objects table-level grants remain unchanged/,
  );
  assert.match(
    assertions,
    /existing Storage bucket metadata remains unchanged/,
  );
  assert.match(
    assertions,
    /existing Storage object metadata remains unchanged/,
  );

  assert.match(assertions, /set local role authenticated;/);
  assert.match(assertions, /authenticated INSERT unexpectedly succeeded/);
  assert.match(assertions, /set local role anon;/);
  assert.match(assertions, /anonymous INSERT unexpectedly succeeded/);
  assert.match(
    assertions,
    /anonymous owner-null UPDATE unexpectedly succeeded/,
  );
  assert.match(
    assertions,
    /former PUBLIC owner-null UPDATE path is rejected by RLS/,
  );

  assert.match(assertions, /when insufficient_privilege then/);
  assert.match(assertions, /row-level security policy/);
  assert.match(assertions, /get diagnostics v_updated_count = row_count/);
});
