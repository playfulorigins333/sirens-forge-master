import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import registryJson from "../registry.json" with { type: "json" };
import { createManifest, serializeManifest, validateRights, type EvidenceInput } from "../manifest";
import { getCandidate, listCandidates, validateRegistry } from "../registry";
import { assertNoSecret, validateLocalPath } from "../security";
import { scanSafeTensor } from "../safetensors";
import type { ArtifactResult, Candidate, TensorResult } from "../types";
import { classifyTensorScan, verifyArtifact } from "../verifier";

async function tensorFixture(dtype: string, data: Buffer, count: number, filename = "fixture.safetensors"): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sf-model-gate-"));
  const header = Buffer.from(JSON.stringify({ weights: { dtype, shape: [count], data_offsets: [0, data.length] } }).padEnd(128, " "));
  const prefix = Buffer.alloc(8); prefix.writeBigUInt64LE(BigInt(header.length)); const file = path.join(dir, filename);
  await writeFile(file, Buffer.concat([prefix, header, data])); return file;
}
const f16 = (...bits: number[]) => { const data = Buffer.alloc(bits.length * 2); bits.forEach((value, index) => data.writeUInt16LE(value, index * 2)); return data; };
const allConfirmed = { commercial_outputs: "CONFIRMED", outside_paid_saas: "CONFIRMED", lora_training: "CONFIRMED", cloud_operation: "CONFIRMED", lawful_explicit_nsfw: "CONFIRMED", upstream_chain: "CONFIRMED" } as const;
const artifact = (candidate: Candidate, file: string): ArtifactResult => ({ ok: true, candidateId: candidate.candidateId, path: file, filename: candidate.filename, bytes: candidate.bytes, sha256: candidate.sha256, failures: [] });
const finiteScan: TensorResult[] = [{ name: "weights", dtype: "F16", shape: [1], nanCount: 0, positiveInfinityCount: 0, negativeInfinityCount: 0 }];

async function evidenceFor(candidate: Candidate, omit?: string): Promise<EvidenceInput[]> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sf-evidence-")); const inputs: EvidenceInput[] = [];
  for (const required of candidate.requiredEvidence) { if (required.category === omit) continue; const file = path.join(dir, `${required.category}.txt`); await writeFile(file, `evidence for ${required.sourceReference}`); inputs.push({ ...required, path: file }); }
  return inputs;
}

test("registry contains the exact locked candidate identities", () => {
  const [bigasp, cyber] = listCandidates();
  assert.deepEqual([bigasp.candidateId,bigasp.model,bigasp.version,bigasp.creator,bigasp.architecture,bigasp.modelId,bigasp.versionId,bigasp.fileId,bigasp.filename,bigasp.bytes,bigasp.sha256,bigasp.status,bigasp.productionStatus],["bigasp-v2","bigASP","v2.0","Nutbutter","SDXL 1.0","502468","991916","897883","bigasp_v20.safetensors",6938040682,"6C77BE501B95DA35528431C224CCFB51B0AE948857431B3556DB64E213CC1EDF","TECHNICAL_CANARY_CANDIDATE","NOT_APPROVED"]);
  assert.deepEqual([cyber.candidateId,cyber.model,cyber.version,cyber.creator,cyber.architecture,cyber.modelId,cyber.versionId,cyber.filename,cyber.bytes,cyber.sha256,cyber.status,cyber.productionStatus],["cyberrealistic-xl-v10","CyberRealistic XL","v10.0","Cyberdelia","SDXL 1.0","312530","2840768","CyberRealisticXLPlay_V10.0_FP16.safetensors",6938041288,"FD5E870B5BBCE4BDDEB64F4BB8E49C57F84AB793C0262A503F0123BE435E667D","TECHNICAL_CANARY_CANDIDATE","NOT_APPROVED"]);
  const upstream = ["SDXL_MODEL_PROVENANCE", "SDXL_OPEN_RAIL_LICENSE", "STABILITY_CORE_MODELS_SCOPE", "STABILITY_TERMS_CONFLICT_CLAUSE", "STABILITY_ACCEPTABLE_USE_POLICY"];
  assert.deepEqual(bigasp.requiredEvidence.filter(item => upstream.includes(item.category)).map(item => item.category), upstream);
  assert.deepEqual(cyber.requiredEvidence.filter(item => upstream.includes(item.category)).map(item => item.category), upstream);
});
test("runtime registry validation rejects malformed registries", () => {
  const mutate = (fn: (value: any) => void) => { const value = structuredClone(registryJson); fn(value); assert.throws(() => validateRegistry(value), /INVALID_REGISTRY/); };
  mutate(v => v.schemaVersion = 2); mutate(v => v.candidates[1].candidateId = v.candidates[0].candidateId); mutate(v => v.candidates[1].filename = v.candidates[0].filename.toUpperCase());
  mutate(v => v.candidates[0].filename = "../unsafe.safetensors"); mutate(v => v.candidates[0].sha256 = "bad"); mutate(v => v.candidates[0].bytes = 0); mutate(v => v.candidates[0].status = "APPROVED");
  mutate(v => v.candidates[0].nonFinitePolicy = "PASS"); mutate(v => v.candidates[0].evidenceSources[0] = "http://unsafe.example"); mutate(v => v.candidates[0].unexpected = true);
  mutate(v => v.candidates[0].evidenceSources[1] = v.candidates[0].evidenceSources[0]);
});
test("unknown candidate fails closed and verifier has no registry override", async () => { await assert.rejects(() => verifyArtifact("unknown", "/tmp/model.safetensors"), /UNKNOWN_CANDIDATE/); assert.equal(verifyArtifact.length, 2); });
test("real verifier rejects canonical filename, byte size, and SHA mismatches", async () => {
  const candidate = getCandidate("bigasp-v2"), wrong = await tensorFixture("F16", f16(0x3c00), 1, "wrong.safetensors"); let result = await verifyArtifact(candidate.candidateId, wrong); assert.ok(result.artifact.failures.includes("FILENAME_MISMATCH"));
  const canonical = path.join(path.dirname(wrong), candidate.filename); await writeFile(canonical, await readFile(wrong)); result = await verifyArtifact(candidate.candidateId, canonical); assert.ok(result.artifact.failures.includes("BYTE_SIZE_MISMATCH")); assert.ok(result.artifact.failures.includes("SHA256_MISMATCH"));
});
test("malformed SafeTensor and a structurally valid F64 tensor fail closed", async () => { const bad = path.join(await mkdtemp(path.join(os.tmpdir(), "sf-bad-")), "bad.safetensors"); await writeFile(bad, "not safetensors"); await assert.rejects(() => scanSafeTensor(bad), /MALFORMED_SAFETENSOR/); const f64 = await tensorFixture("F64", Buffer.alloc(8), 1); await assert.rejects(() => scanSafeTensor(f64), /UNSUPPORTED_DTYPE: F64 is not approved or reference-tested/); });
test("F16 reference bit patterns count finite, NaN, +Inf, and -Inf exactly", async () => { const file = await tensorFixture("F16", f16(0x0000,0x3c00,0xbc00,0x7e00,0x7c00,0xfc00), 6); assert.deepEqual(await scanSafeTensor(file), [{name:"weights",dtype:"F16",shape:[6],nanCount:1,positiveInfinityCount:1,negativeInfinityCount:1}]); });
test("F32 scanning remains reference tested", async () => { const data=Buffer.alloc(16);[1,NaN,Infinity,-Infinity].forEach((v,i)=>data.writeFloatLE(v,i*4));const file=await tensorFixture("F32",data,4);assert.deepEqual(await scanSafeTensor(file),[{name:"weights",dtype:"F32",shape:[4],nanCount:1,positiveInfinityCount:1,negativeInfinityCount:1}]); });
test("candidate policies classify non-finite scans without overriding identity", () => { const nonfinite=[{...finiteScan[0],nanCount:1}]; assert.equal(classifyTensorScan(getCandidate("bigasp-v2").nonFinitePolicy,nonfinite),"BLOCKED");assert.equal(classifyTensorScan(getCandidate("cyberrealistic-xl-v10").nonFinitePolicy,nonfinite),"REVIEW_REQUIRED");assert.equal(classifyTensorScan("BLOCKED",finiteScan),"TENSOR_VERIFIED"); });
test("all confirmed rights without required evidence remain incomplete", async () => { const candidate=getCandidate("bigasp-v2"),file="/operator/bigasp_v20.safetensors";const manifest=await createManifest({candidateId:candidate.candidateId,capturedAtUtc:"2026-08-22T00:00:00.000Z",evidence:[],rights:allConfirmed,artifact:artifact(candidate,file),tensors:finiteScan,scanState:"TENSOR_VERIFIED"});assert.equal(manifest.status,"EVIDENCE_INCOMPLETE"); });
test("manifest rejects forged artifact identity and empty scan", async () => { const candidate=getCandidate("bigasp-v2"),base={candidateId:candidate.candidateId,capturedAtUtc:"2026-08-22T00:00:00.000Z",evidence:await evidenceFor(candidate),rights:allConfirmed,artifact:artifact(candidate,"/operator/bigasp_v20.safetensors"),scanState:"TENSOR_VERIFIED" as const};const forged=await createManifest({...base,artifact:{...base.artifact,sha256:"0".repeat(64)},tensors:finiteScan});assert.equal(forged.status,"BLOCKED");const empty=await createManifest({...base,tensors:[]});assert.equal(empty.status,"BLOCKED"); });
test("missing evidence category remains incomplete; complete preserved evidence can become canary-ready", async () => { const candidate=getCandidate("bigasp-v2"),base={candidateId:candidate.candidateId,capturedAtUtc:"2026-08-22T00:00:00.000Z",rights:allConfirmed,artifact:artifact(candidate,"/operator/bigasp_v20.safetensors"),tensors:finiteScan,scanState:"TENSOR_VERIFIED" as const};const incomplete=await createManifest({...base,evidence:await evidenceFor(candidate,"MODEL_LICENSE")});assert.equal(incomplete.status,"EVIDENCE_INCOMPLETE");const complete=await createManifest({...base,evidence:await evidenceFor(candidate)});assert.equal(complete.status,"READY_FOR_TECHNICAL_CANARY");assert.ok(complete.evidenceRecords.every(record=>/^[A-F0-9]{64}$/.test(record.sha256)));assert.equal(serializeManifest(complete),serializeManifest(complete)); });
test("Cyber operator evidence placeholder always blocks readiness", async () => { const candidate=getCandidate("cyberrealistic-xl-v10"),manifest=await createManifest({candidateId:candidate.candidateId,capturedAtUtc:"2026-08-22T00:00:00.000Z",evidence:await evidenceFor(candidate),rights:allConfirmed,artifact:artifact(candidate,"/operator/Cyber.safetensors"),tensors:finiteScan,scanState:"TENSOR_VERIFIED"});assert.equal(manifest.status,"EVIDENCE_INCOMPLETE");assert.notEqual(manifest.status as string,"PRODUCTION_APPROVED"); });
test("UNKNOWN rights, secrets, unsafe paths, and symlinks fail closed", async () => { assert.equal(validateRights({}).cloud_operation,"UNKNOWN");assert.throws(()=>assertNoSecret("access_token=abc"),/SENSITIVE_VALUE/);assert.throws(()=>validateLocalPath("relative/file"),/UNSAFE_PATH/);assert.throws(()=>validateLocalPath("/tmp/../outside"),/UNSAFE_PATH/);const target=await tensorFixture("F16",f16(0),1),link=path.join(path.dirname(target),"link.safetensors");await symlink(target,link);const candidate=getCandidate("bigasp-v2"),result=await verifyArtifact(candidate.candidateId,link);assert.ok(result.artifact.failures.includes("UNSAFE_PATH")); });
