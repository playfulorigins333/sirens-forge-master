#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { verifyArtifact } from "./verifier";
import { createManifest, serializeManifest, type EvidenceInput } from "./manifest";
import { assertNoSecret, validateLocalPath } from "./security";
import type { Rights } from "./types";

function emit(value:unknown):void{process.stdout.write(`${JSON.stringify(value,null,2)}\n`);}
async function main():Promise<void>{
  for(const arg of process.argv.slice(2))assertNoSecret(arg,"argument");
  const [command,candidateId,checkpointPath,...rest]=process.argv.slice(2);
  if(!command||!candidateId||!checkpointPath)throw new Error("USAGE: verify <candidate-id> <absolute-checkpoint-path> OR manifest <candidate-id> <absolute-checkpoint-path> <absolute-output-path> <UTC-time> <rights-json> <evidence-json>");
  const result=await verifyArtifact(candidateId,checkpointPath);
  if(command==="verify"){emit(result);if(!result.artifact.ok||result.state==="BLOCKED"||result.state==="REVIEW_REQUIRED")process.exitCode=2;return;}
  if(command!=="manifest")throw new Error(`UNKNOWN_COMMAND: ${command}`);
  const [outputPath,capturedAtUtc,rightsJson,evidenceJson,...unexpected]=rest;if(!outputPath||!capturedAtUtc||!rightsJson||!evidenceJson||unexpected.length)throw new Error("INVALID_MANIFEST_ARGUMENTS");
  let rights:Partial<Rights>,evidence:EvidenceInput[];try{rights=JSON.parse(rightsJson);evidence=JSON.parse(evidenceJson);if(!Array.isArray(evidence))throw new Error();}catch{throw new Error("INVALID_MANIFEST_JSON");}
  const manifest=await createManifest({candidateId,capturedAtUtc,evidence,rights,artifact:result.artifact,tensors:result.tensors??[],scanState:result.state});
  const safeOutput=validateLocalPath(outputPath);await writeFile(safeOutput,serializeManifest(manifest),{encoding:"utf8",flag:"wx",mode:0o600});emit({ok:true,outputPath:safeOutput,status:manifest.status});
  if(manifest.status!=="READY_FOR_TECHNICAL_CANARY")process.exitCode=2;
}
main().catch(error=>{emit({ok:false,error:error instanceof Error?error.message:"UNKNOWN_ERROR"});process.exitCode=1;});
