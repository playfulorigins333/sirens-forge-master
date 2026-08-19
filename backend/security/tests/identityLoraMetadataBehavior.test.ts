import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildWorkflow } from "../../../lib/comfy/buildWorkflow";
import {
  resolveOwnedIdentityLoraMetadata,
  type IdentityLoraMetadataDependencies,
} from "../../../lib/generation/identityLoraMetadata";
import { resolveLoraStack } from "../../../lib/generation/lora-resolver";

const owner = "11111111-1111-4111-8111-111111111111";
const foreign = "22222222-2222-4222-8222-222222222222";
const lora = "33333333-3333-4333-8333-333333333333";

function deps(options: { owner?: string; status?: string; key?: string; token?: string; fail?: boolean } = {}) {
  let queries = 0;
  const value: IdentityLoraMetadataDependencies = {
    async loadOwnedCompletedLora(id, userId) {
      queries++;
      if (options.fail) throw new Error("raw provider detail");
      if (id !== lora || userId !== (options.owner ?? owner) || (options.status ?? "completed") !== "completed") return null;
      return {
        artifact_r2_bucket: "identity-loras",
        artifact_r2_key: options.key ?? "owned/artifact.safetensors",
        trigger_token: options.token ?? "owner_token",
      };
    },
  };
  return { value, get queries() { return queries; } };
}

await assert.rejects(() => resolveOwnedIdentityLoraMetadata(lora, foreign, deps().value), /IDENTITY_LORA_UNAVAILABLE/);
await assert.rejects(() => resolveOwnedIdentityLoraMetadata(lora, owner, deps({ status: "training" }).value), /IDENTITY_LORA_UNAVAILABLE/);
const malformed = deps();
await assert.rejects(() => resolveOwnedIdentityLoraMetadata("not-a-uuid", owner, malformed.value), /IDENTITY_LORA_UNAVAILABLE/);
assert.equal(malformed.queries, 0, "malformed IDs must fail before querying");
await assert.rejects(() => resolveOwnedIdentityLoraMetadata(lora, owner, deps({ key: " " }).value), /IDENTITY_LORA_UNAVAILABLE/);
await assert.rejects(() => resolveOwnedIdentityLoraMetadata(lora, owner, deps({ token: " " }).value), /IDENTITY_LORA_UNAVAILABLE/);
await assert.rejects(() => resolveOwnedIdentityLoraMetadata(lora, owner, deps({ fail: true }).value), /IDENTITY_LORA_UNAVAILABLE/);

const metadata = await resolveOwnedIdentityLoraMetadata(lora, owner, deps().value);
assert.equal(metadata.trigger_token, "owner_token");
const feminine = await resolveLoraStack("body_feminine", null, owner);
const masculine = await resolveLoraStack("body_masculine", null, owner);
assert.deepEqual(feminine.loras, [{ path: "body_feminine.safetensors", strength: 0.75 }]);
assert.deepEqual(masculine.loras, [{ path: "body_masculine.safetensors", strength: 0.75 }]);

const stack = await resolveLoraStack("body_feminine", lora, owner, deps().value);
assert.equal(stack.loras.length, 2, "the stack is limited to one body plus one identity LoRA");
assert.deepEqual(stack.loras[1], { path: `identity_${lora}.safetensors`, strength: 1.15 });
assert.equal(stack.trigger_token, "owner_token");
const workflow = buildWorkflow({ prompt: "test", negative: "", seed: 1, steps: 20, cfg: 7, width: 512, height: 512, loraStack: stack, dnaImageNames: [], fluxLock: null }) as Record<string, any>;
assert.equal(workflow["12"].inputs.lora_name, "body_feminine.safetensors");
assert.equal(workflow["12"].inputs.strength_model, 0.75);
assert.deepEqual(workflow["13"].inputs.model, ["12", 0], "identity must follow the body node");
assert.equal(workflow["13"].inputs.lora_name, `identity_${lora}.safetensors`);
assert.equal(workflow["13"].inputs.strength_model, 1.15);
assert.equal(workflow["13"].inputs.strength_clip, 1.0);

const bodyOnlyWorkflow = buildWorkflow({ prompt: "test", negative: "", seed: 1, steps: 20, cfg: 7, width: 512, height: 512, loraStack: feminine, dnaImageNames: [], fluxLock: null }) as Record<string, any>;
assert.equal(bodyOnlyWorkflow["13"], undefined, "no identity selection must create no identity node");

for (const sourcePath of ["lib/generation/identityLoraMetadata.ts", "lib/generation/lora-resolver.ts"]) {
  const source = await readFile(sourcePath, "utf8");
  for (const forbidden of ["@aws-sdk/client-s3", "GetObjectCommand", "download(", "writeFile", "copyFile", "/tmp/loras", "/workspace/ComfyUI"]) {
    assert(!source.includes(forbidden), `${sourcePath} must not perform frontend artifact I/O: ${forbidden}`);
  }
}
await assert.rejects(() => resolveLoraStack("body_mtf", null, owner), /Unsupported body mode for launch/);
await assert.rejects(() => resolveLoraStack("body_ftm", null, owner), /Unsupported body mode for launch/);
console.log("identity LoRA metadata and workflow contracts: PASS");
