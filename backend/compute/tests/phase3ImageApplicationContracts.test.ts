import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildDurableIdentityReference } from "../../../lib/generation/identityLoraMetadata";
import { normalizeDurableImageSettings } from "../../../lib/generation/durableImageRequest";
import { loadCreatorImageResult } from "../../../lib/generation/durableImageResult";

const source = (path: string) => readFileSync(path, "utf8");

test("durable and legacy Image gates remain independent and private delivery fails closed", () => {
  const post = source("app/api/generate/route.ts");
  const availability = source("app/api/generate/availability/route.ts");
  assert.match(post, /durableComputeEnabled && !isPrivateCreatorMediaDeliveryReady\(\)/);
  assert.match(post, /!durableComputeEnabled && !isGenerationExecutionEnabled\(\)/);
  assert.match(post, /durableComputeEnabled \? null : requireSirensApiConfig\(\)/);
  assert.match(availability, /durable \? isPrivateCreatorMediaDeliveryReady\(\) : isGenerationExecutionEnabled\(\)/);
});

test("durable identity reference is derived and trimmed on the server", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const owner = "22222222-2222-4222-8222-222222222222";
  const reference = await buildDurableIdentityReference(id, owner, {
    async loadOwnedCompletedLora() { return { artifact_r2_bucket: " bucket ", artifact_r2_key: " key ", trigger_token: " token " }; },
  });
  assert.deepEqual(reference, { id, bucket: "bucket", key: "key", trigger_token: "token" });
  const post = source("app/api/generate/route.ts");
  assert.match(post, /identity_reference: identityReference/);
  assert.doesNotMatch(source("app/generate/page.tsx"), /identity_reference|artifact_r2_bucket|artifact_r2_key|trigger_token/);
  const upper = await buildDurableIdentityReference(id.toUpperCase(), owner, {
    async loadOwnedCompletedLora(queried) { assert.equal(queried, id); return { artifact_r2_bucket: "bucket", artifact_r2_key: "key", trigger_token: "token" }; },
  });
  assert.equal(upper.id, id);
  await assert.rejects(() => buildDurableIdentityReference("bad", owner), /IDENTITY_LORA_UNAVAILABLE/);
  assert.match(post, /identity_id: identityReference\?\.id \?\? null/);
  assert.match(post, /typeof body\.identity_lora !== "string"/);
});

test("durable numeric settings always satisfy finalizer requirements", () => {
  const fractional = normalizeDurableImageSettings({ width: 1024.9, height: 1536.8, steps: 28.7, cfg: 7.5, seed: 1.9, batch: 3.8 });
  assert.deepEqual(fractional, { width: 1024, height: 1536, steps: 28, cfg: 7.5, seed: 1, output_count: 3 });
  for (const input of [
    { width: NaN, height: Infinity, steps: NaN, cfg: Infinity, seed: -1, batch: NaN },
    { width: Infinity, height: NaN, steps: Infinity, cfg: NaN, seed: Number.MAX_SAFE_INTEGER + 1, batch: Infinity },
  ]) {
    const value = normalizeDurableImageSettings(input);
    assert(Number.isInteger(value.width) && value.width >= 256 && value.width <= 2048);
    assert(Number.isInteger(value.height) && value.height >= 256 && value.height <= 2048);
    assert(Number.isInteger(value.steps) && value.steps >= 1 && value.steps <= 150);
    assert(Number.isFinite(value.cfg) && value.cfg >= 1 && value.cfg <= 30);
    assert(Number.isSafeInteger(value.seed) && value.seed >= 0);
    assert(Number.isInteger(value.output_count) && value.output_count >= 1 && value.output_count <= 4);
  }
  assert.match(source("app/api/generate/route.ts"), /const durableSettings = normalizeDurableImageSettings\(normalized\)[\s\S]*\.\.\.durableSettings/);
});

test("durable product is bound to its compute job before relational reads", async () => {
  const job = "11111111-1111-4111-8111-111111111111";
  const asset = "33333333-3333-4333-8333-333333333333";
  let table = "";
  const admin = { from(name: string) { table = name; const query: any = { select(){return query}, eq(){return query}, order(){return Promise.resolve({ data: [{ id: asset, generation_id: job, owner_id: "owner", ordinal: 0, kind: "image" }], error: null })}, maybeSingle(){return Promise.resolve({ data: { id: job, prompt: "p", status: "completed", job_type: "image" }, error: null })} }; return query; } };
  const valid = await loadCreatorImageResult(admin, "owner", job, { generation_id: job, asset_ids: [asset] });
  assert.equal(valid?.generation_id, job); assert.equal(table, "generation_assets");
  let queried = false;
  const rejected = await loadCreatorImageResult({ from(){ queried = true; throw new Error("must not query"); } }, "owner", job, { generation_id: "22222222-2222-4222-8222-222222222222", asset_ids: [asset] });
  assert.equal(rejected, null); assert.equal(queried, false);
});

test("creator selector and durable result projection are server-authoritative and safe", () => {
  const identities = source("app/api/generate/identities/route.ts");
  const result = source("lib/generation/durableImageResult.ts");
  const status = source("app/api/compute/jobs/[jobId]/route.ts");
  assert.match(identities, /artifact_r2_bucket\?\.trim\(\).*artifact_r2_key\?\.trim\(\).*trigger_token\?\.trim\(\)/s);
  assert.match(identities, /\{ id: row\.id, name: row\.name \?\? null \}/);
  assert.match(result, /\.eq\("user_id", ownerId\).*\.eq\("status", "completed"\).*\.eq\("job_type", "image"\)/s);
  assert.match(result, /assets\.length !== assetIds\.length/);
  assert.match(result, /asset\.ordinal !== ordinal/);
  assert.match(status, /image_result: imageResult/);
  assert.doesNotMatch(result, /object_key|storage_object_id|sha256|provider|worker|lease|cost|trigger_token|bucket/);
});

test("Generate hydrates durable private outputs and reports terminal truth", () => {
  const page = source("app/generate/page.tsx");
  assert.match(page, /job\.image_result/);
  assert.match(page, /resolveGenerationOutputUrl\(output\)/);
  assert.match(page, /generationAssetId: output\.id/);
  assert.match(page, /dbGenerationId: result\.generation_id/);
  assert.match(page, /privateAsset: true/);
  assert.match(page, /setItems\(.*addUnique/s);
  assert.match(page, /setHistory\(addUnique\)/);
  assert.match(page, /Image generation failed\. Please try again\./);
  assert.match(page, /Image generation was cancelled\./);
  assert.match(page, /setQueuedComputeMessage\(activeStatuses\.length .* : null\)/s);
  assert.doesNotMatch(page, /if \(!durableCompute \|\| !activeComputeJobIds\.length\)/);
  assert.match(page, /restored\.map\(canonicalComputeJobId\)/);
  assert.match(page, /response\?\.status === 404[\s\S]*terminalIds\.push\(jobId\)/);
  assert.match(page, /data\?\.workload !== "image" \|\| !canonicalJobId/);
  assert.doesNotMatch(page, /Style Preset|balanced quality|medium consistency/);
  assert.match(page, /Style direction: \$\{styleHint\}/);
});

test("browser Image intent is exact and provider-neutral", () => {
  const page = source("app/generate/page.tsx");
  const request = page.slice(page.indexOf("const imageRequest ="), page.indexOf("const runCount ="));
  for (const field of ["prompt", "negative_prompt", "body_mode", "width", "height", "steps", "cfg", "seed", "identity_lora"]) assert.match(request, new RegExp(`${field}:?`));
  for (const forbidden of ["engine", "template", "provider", "checkpoint", "runpod", "salad", "kelpie", "trigger_token", "artifact"]) assert.doesNotMatch(request.toLowerCase(), new RegExp(forbidden));
  assert.match(page, /durableIntent = \{ \.\.\.imageRequest, batch: runCount \}/);
});
