import assert from "node:assert/strict";
import test from "node:test";
import { canonicalWarningSnapshot, classifyTrainingDecision, DATASET_DOCTOR_TRAINING_DECISION_VERSION, sha256Fingerprint } from "../../../lib/dataset-doctor/training-decision-contract";
import { DATASET_LIMITS } from "../../../lib/dataset-doctor/dataset-limits";

test("dataset capacity supports 30+ without making count a readiness decision", () => {
  assert.ok(DATASET_LIMITS.maximumUploadCount >= 30);
  assert.equal(classifyTrainingDecision({ dataset_ready: false, dataset_warnings: ["coverage"] }, 30).overridable, true);
});
test("warning snapshots and fingerprints are canonical and versioned", () => {
  const a = canonicalWarningSnapshot({ dataset_warnings: ["z", "a"], missing_coverage: ["side", "face"], unrelated: "secret" });
  const b = canonicalWarningSnapshot({ missing_coverage: ["face", "side"], dataset_warnings: ["a", "z"] });
  assert.deepEqual(a, b); assert.equal(sha256Fingerprint(a), sha256Fingerprint(b));
  assert.match(sha256Fingerprint(a), /^[0-9a-f]{64}$/); assert.equal(DATASET_DOCTOR_TRAINING_DECISION_VERSION, "dataset-doctor-training-decision-v1");
  assert.equal("unrelated" in a, false);
});
test("quality concerns are overridable but explicit blockers are not", () => {
  assert.equal(classifyTrainingDecision({ dataset_ready: false, needs_more_images: true }, 5).overridable, true);
  assert.deepEqual(classifyTrainingDecision({ dataset_ready: false, non_overridable_conditions: ["consent"] }, 5), { overridable: false, blockers: ["consent"] });
  assert.equal(classifyTrainingDecision({ dataset_ready: false }, 0).overridable, false);
  assert.equal(classifyTrainingDecision({ dataset_ready: true }, 30).overridable, false);
});
