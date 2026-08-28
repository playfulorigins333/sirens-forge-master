import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildDurableIdentityReference } from "../../../lib/generation/identityLoraMetadata";

const source = (path: string) => readFileSync(path, "utf8");

test("durable and legacy Image gates remain independent and private delivery fails closed", () => {
  const post = source("app/api/generate/route.ts");
  const availability = source("app/api/generate/availability/route.ts");
  assert.match(post, /durableComputeEnabled && !isPrivateCreatorMediaEnabled\(\)/);
  assert.match(post, /!durableComputeEnabled && !isGenerationExecutionEnabled\(\)/);
  assert.match(post, /durableComputeEnabled \? null : requireSirensApiConfig\(\)/);
  assert.match(availability, /durable \? isPrivateCreatorMediaEnabled\(\) : isGenerationExecutionEnabled\(\)/);
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
