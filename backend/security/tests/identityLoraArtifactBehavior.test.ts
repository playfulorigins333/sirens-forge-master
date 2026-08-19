import assert from "node:assert/strict";
import { ensureUserLoraCached, type LoraCacheDependencies } from "../../../lib/generation/ensureUserLoraCached";
import { resolveLoraStack, type LoraMaterializationDependencies } from "../../../lib/generation/lora-resolver";
import type { IdentityLoraArtifactStat } from "../../../lib/generation/identityLoraArtifact";

const owner = "11111111-1111-4111-8111-111111111111";
const lora = "33333333-3333-4333-8333-333333333333";
const cachePath = `/tmp/loras/${lora}.safetensors`;
type Kind = "file" | "empty" | "symlink" | "directory";
const stat = (kind: Kind): IdentityLoraArtifactStat => ({
  isFile: () => kind === "file" || kind === "empty" || kind === "symlink",
  isSymbolicLink: () => kind === "symlink",
  size: kind === "empty" ? 0 : 4,
});

function cacheHarness(options: {
  initial?: Kind;
  owned?: boolean;
  download?: Uint8Array;
  publishRaceWinner?: Kind;
  publishFails?: boolean;
} = {}) {
  const artifacts = new Map<string, Kind>();
  if (options.initial) artifacts.set(cachePath, options.initial);
  const events: string[] = [];
  let downloads = 0;
  let writes = 0;
  let publishes = 0;
  const removed: string[] = [];
  const deps: LoraCacheDependencies = {
    async loadOwnedCompletedLora() {
      events.push("ownership");
      return options.owned === false ? null : { artifact_r2_bucket: null, artifact_r2_key: "owned/key", trigger_token: "token" };
    },
    async lstat(file) {
      events.push(`lstat:${file}`);
      const kind = artifacts.get(file);
      if (!kind) throw new Error("ENOENT");
      return stat(kind);
    },
    async download() { downloads += 1; return options.download ?? new Uint8Array([1, 2, 3]); },
    async write(file) { writes += 1; artifacts.set(file, "file"); },
    async publish(source, destination) {
      publishes += 1;
      if (options.publishRaceWinner) {
        artifacts.set(destination, options.publishRaceWinner);
        throw new Error("EEXIST");
      }
      if (options.publishFails) throw new Error("publish failed");
      artifacts.set(destination, artifacts.get(source) ?? "file");
    },
    async remove(file) { removed.push(file); artifacts.delete(file); },
  };
  return { deps, artifacts, events, removed, get downloads() { return downloads; }, get writes() { return writes; }, get publishes() { return publishes; } };
}

// Ownership is resolved before a valid cache can be trusted, and denial never consults cache/R2.
const valid = cacheHarness({ initial: "file" });
assert.equal((await ensureUserLoraCached(lora, owner, valid.deps)).localPath, cachePath);
assert.equal(valid.events[0], "ownership");
assert.equal(valid.downloads, 0);
assert.equal(valid.writes, 0);
assert.equal(valid.publishes, 0);
const denied = cacheHarness({ initial: "file", owned: false });
await assert.rejects(() => ensureUserLoraCached(lora, owner, denied.deps), /IDENTITY_LORA_UNAVAILABLE/);
assert.deepEqual(denied.events, ["ownership"]);

// Invalid cache artifacts are removed and safely rematerialized rather than returned.
for (const kind of ["empty", "symlink", "directory"] as const) {
  const invalid = cacheHarness({ initial: kind });
  await ensureUserLoraCached(lora, owner, invalid.deps);
  assert.equal(invalid.downloads, 1, kind);
  assert.equal(invalid.artifacts.get(cachePath), "file", kind);
  assert(invalid.removed.includes(cachePath), kind);
}
const emptyDownload = cacheHarness({ download: new Uint8Array() });
await assert.rejects(() => ensureUserLoraCached(lora, owner, emptyDownload.deps), /IDENTITY_LORA_UNAVAILABLE/);
assert.equal(emptyDownload.writes, 0);

// A losing publisher accepts only a valid winner; temporary files are cleaned on every path.
const validRace = cacheHarness({ publishRaceWinner: "file" });
await ensureUserLoraCached(lora, owner, validRace.deps);
assert(validRace.removed.some((file) => file.endsWith(".tmp")));
for (const winner of ["empty", "symlink", "directory"] as const) {
  const invalidRace = cacheHarness({ publishRaceWinner: winner });
  await assert.rejects(() => ensureUserLoraCached(lora, owner, invalidRace.deps), /IDENTITY_LORA_UNAVAILABLE/, winner);
  assert(invalidRace.removed.some((file) => file.endsWith(".tmp")), winner);
}
const failedPublish = cacheHarness({ publishFails: true });
await assert.rejects(() => ensureUserLoraCached(lora, owner, failedPublish.deps), /IDENTITY_LORA_UNAVAILABLE/);
assert(failedPublish.removed.some((file) => file.endsWith(".tmp")));

function materializationHarness(initial?: Kind, raceWinner?: Kind) {
  const artifacts = new Map<string, Kind>();
  const destination = `/workspace/ComfyUI/models/loras/identity_${lora}.safetensors`;
  if (initial) artifacts.set(destination, initial);
  let copies = 0;
  const removed: string[] = [];
  const deps: LoraMaterializationDependencies = {
    async lstat(file) { const kind = artifacts.get(file); if (!kind) throw new Error("ENOENT"); return stat(kind); },
    async mkdir() {},
    async copyExclusive(_source, target) {
      copies += 1;
      if (raceWinner) { artifacts.set(target, raceWinner); throw new Error("EEXIST"); }
      artifacts.set(target, "file");
    },
    async remove(file) { removed.push(file); artifacts.delete(file); },
  };
  return { deps, destination, artifacts, removed, get copies() { return copies; } };
}
const cached = cacheHarness({ initial: "file" });
const existingComfy = materializationHarness("file");
const twoLoras = await resolveLoraStack("body_feminine", lora, owner, cached.deps, existingComfy.deps);
assert.equal(existingComfy.copies, 0);
assert.equal(twoLoras.loras.length, 2);
assert.deepEqual(twoLoras.loras.map((entry) => entry.path), ["body_feminine.safetensors", `identity_${lora}.safetensors`]);

for (const kind of ["empty", "symlink", "directory"] as const) {
  const invalid = materializationHarness(kind);
  await resolveLoraStack("none", lora, owner, cached.deps, invalid.deps);
  assert.equal(invalid.copies, 1, kind);
  assert(invalid.removed.includes(invalid.destination), kind);
  assert.equal(invalid.artifacts.get(invalid.destination), "file", kind);
}
const normal = materializationHarness();
await resolveLoraStack("none", lora, owner, cached.deps, normal.deps);
assert.equal(normal.copies, 1);
const validCopyRace = materializationHarness(undefined, "file");
await resolveLoraStack("none", lora, owner, cached.deps, validCopyRace.deps);
for (const winner of ["empty", "symlink", "directory"] as const) {
  const invalidCopyRace = materializationHarness(undefined, winner);
  await assert.rejects(
    () => resolveLoraStack("none", lora, owner, cached.deps, invalidCopyRace.deps),
    /IDENTITY_LORA_MATERIALIZATION_FAILED/,
    winner,
  );
}
await assert.rejects(() => resolveLoraStack("body_mtf", null, owner), /Unsupported body mode for launch/);
await assert.rejects(() => resolveLoraStack("body_ftm", null, owner), /Unsupported body mode for launch/);

console.log("identity-LoRA artifact behavioral contracts: PASS");
