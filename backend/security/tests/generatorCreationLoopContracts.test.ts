import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildCreationLoopHandoff,
  CREATION_LOOP_HANDOFF_STORAGE_KEY,
  parseCreationLoopHandoff,
} from "../../../lib/creation-loop/handoff";

const identityId = "33333333-3333-4333-8333-333333333333";
const assetId = "44444444-4444-4444-8444-444444444444";

const promptOnly = buildCreationLoopHandoff({ id: assetId, kind: "image", prompt: "portrait" });
assert.equal(promptOnly.identityId, undefined);
assert.equal(parseCreationLoopHandoff(JSON.stringify(promptOnly))?.identityId, undefined);

const identityBacked = buildCreationLoopHandoff({ id: assetId, kind: "image", prompt: "portrait", identityLora: identityId });
assert.equal(identityBacked.identityId, identityId);

const identitySeed = buildCreationLoopHandoff({ id: identityId, kind: "identity", prompt: "identity concept", isIdentitySeed: true });
assert.equal(identitySeed.identityId, identityId);
assert.equal(buildCreationLoopHandoff({ id: "not-an-identity", kind: "identity", prompt: "concept" }).identityId, undefined);

const generator = await readFile("app/generate/page.tsx", "utf8");
const library = await readFile("app/library/LibraryClient.tsx", "utf8");
const buildModel = await readFile("components/generate/BuildMyModelCard.tsx", "utf8");

for (const source of [generator, library]) assert(source.includes("CREATION_LOOP_HANDOFF_STORAGE_KEY"));
assert(!generator.includes("sf_reuse_identity"));
assert(!library.includes("sirensforge:vault_identity_reuse"));
assert.equal(CREATION_LOOP_HANDOFF_STORAGE_KEY, "sirensforge:creation_loop_handoff");

assert(generator.includes('label: "No AI Twin — prompt only"'));
assert(!generator.includes("Select AI Twin First"));
assert(!generator.includes("identity-first by design"));
assert(!generator.includes("Select or create an AI Twin identity first."));
assert(generator.includes('.eq("status", "completed")'));
assert(generator.includes("identity_lora: selectedLoraId ? selectedLoraId : null"));
assert(generator.includes("void handleGenerate(result.prompt)"));
assert(!generator.includes("Build My Model needs to save a starter identity"));
assert(buildModel.includes("props.onGenerateNow?.(compiled)"));

for (const leaked of ["bigLust_v16", "Flux / I2V motion", "Flux Cinematic", "SDXL + LoRA Identity", "SDXL max"]) {
  assert(!generator.includes(leaked), `creator-facing implementation label remains: ${leaked}`);
}

assert.match(generator, /min=\{1\}[\s\S]*max=\{4\}/);
assert(generator.includes("Math.min(4, Math.max(1"));
assert(library.includes("Prompt-only creations, ready to reuse as they are."));

console.log("generator and Creation Loop product contracts: PASS");
