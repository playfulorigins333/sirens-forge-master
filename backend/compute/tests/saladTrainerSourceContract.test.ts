import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const executor = readFileSync(path.join(root, "salad/trainer/executor.py"), "utf8");
const dockerfile = readFileSync(path.join(root, "salad/trainer/Dockerfile"), "utf8");
const job = JSON.parse(readFileSync(path.join(root, "salad/trainer/kelpie-job.example.json"), "utf8"));

test("executor has no direct control-plane, storage, or provider access", () => {
  for (const forbidden of ["supabase", "postgrest", "boto3", "cloudflare", "salad api", "provider api", "shell=true"])
    assert.equal(executor.toLowerCase().includes(forbidden), false, forbidden);
  assert.match(executor, /subprocess\.run\(command, check=False\)/);
});

test("container uses immutable toolchain pins and Kelpie command", () => {
  assert.match(dockerfile, /pytorch\/pytorch:2\.6\.0-cuda12\.6-cudnn9-runtime@sha256:f894dae26e1ee8557c544f9cfdb9dc011b1552bf3c1e656b422f2e221d380e40/);
  assert.match(dockerfile, /37a1cbbc5725ed2a3575506e7bd2001c9908ac92/);
  assert.match(dockerfile, /KELPIE_VERSION=0\.7\.2/);
  assert.match(dockerfile, /a0b98e9d44fb4ebbe3b8267e7545616a6814f9b07f9757e00ca84037b73f20f8/);
  assert.match(dockerfile, /sha256sum --check --strict/);
  assert.match(dockerfile, /CMD \["\/usr\/local\/bin\/kelpie"\]/);
  for (const forbidden of ["biglust", "vae.safetensors", "base.safetensors", "aws_access_key", "salad_api_key"])
    assert.equal(dockerfile.toLowerCase().includes(forbidden), false, forbidden);
});

test("Kelpie example preserves authoritative and attempt-isolated mappings", () => {
  assert.equal(job.command, "python");
  assert.equal(job.sync.before[0].prefix, "<AUTHORITATIVE_FINAL_R2_PREFIX>");
  assert.equal(job.sync.before[0].bucket, "<DATASET_BUCKET>");
  assert.equal(job.sync.before[3].prefix, "trainer-checkpoints/<ATTEMPT_ID>");
  assert.equal(job.sync.during[0].prefix, "trainer-checkpoints/<ATTEMPT_ID>");
  assert.equal(job.sync.after[0].prefix, "loras/<IDENTITY_ID>");
  assert.equal(job.sync.after[0].local_path, "/opt/sirens/output");
  assert.equal("webhook" in job || "container_group_id" in job, false);
});

test("legacy trainer is unchanged from the externally verified base", () => {
  execFileSync("git", ["diff", "--quiet", "c14650a4c62109d098d85159698003a5ba13570d", "--", "runpod/train_lora.py"]);
});
