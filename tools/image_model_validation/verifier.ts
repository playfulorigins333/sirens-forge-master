import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { getCandidate } from "./registry";
import { validateLocalPath } from "./security";
import { scanSafeTensor } from "./safetensors";
import type { ArtifactResult, Candidate, TensorResult, ValidationState } from "./types";

export async function sha256File(filePath:string):Promise<string>{const hash=createHash("sha256");for await(const chunk of createReadStream(filePath))hash.update(chunk as Buffer);return hash.digest("hex").toUpperCase();}

export async function verifyArtifact(candidateId:string,inputPath:string,candidateOverride?:Candidate):Promise<{artifact:ArtifactResult;tensors?:TensorResult[];state:ValidationState}> {
  const candidate=candidateOverride ?? getCandidate(candidateId); const safePath=validateLocalPath(inputPath); const failures:string[]=[];
  let stat; try { stat=await lstat(safePath); } catch { return {artifact:{ok:false,candidateId,path:safePath,filename:path.basename(safePath),bytes:0,sha256:"",failures:["FILE_NOT_FOUND"]},state:"BLOCKED"}; }
  if(!stat.isFile() || stat.isSymbolicLink()) failures.push("UNSAFE_PATH");
  const resolved=await realpath(safePath); if(resolved!==safePath) failures.push("UNSAFE_PATH");
  if(path.extname(safePath).toLowerCase()!==".safetensors") failures.push("UNSAFE_CHECKPOINT_FORMAT");
  if(path.basename(safePath)!==candidate.filename) failures.push("FILENAME_MISMATCH");
  if(stat.size!==candidate.bytes) failures.push("BYTE_SIZE_MISMATCH");
  const sha256=stat.isFile()?await sha256File(safePath):""; if(sha256!==candidate.sha256.toUpperCase()) failures.push("SHA256_MISMATCH");
  let tensors:TensorResult[]|undefined;
  if(!failures.length){try{tensors=await scanSafeTensor(safePath);}catch(error){failures.push(error instanceof Error?error.message:"MALFORMED_SAFETENSOR");}}
  const artifact={ok:failures.length===0,candidateId,path:safePath,filename:path.basename(safePath),bytes:stat.size,sha256,failures};
  if(!artifact.ok)return {artifact,state:"BLOCKED"};
  const nonFinite=tensors!.some(t=>t.nanCount+t.positiveInfinityCount+t.negativeInfinityCount>0);
  return {artifact,tensors,state:nonFinite?candidate.nonFinitePolicy:"TENSOR_VERIFIED"};
}
