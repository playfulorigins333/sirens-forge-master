import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { NextRequest } from "next/server";
import { POST as attest } from "../../../app/api/age-attestation/route";
import { handleSafetyReport } from "../../../lib/safety/intakeRouteCore";
import { classifySafetyRpcError } from "../../../lib/safety/contracts";
import { assertRuntimeSafetyAllowsEnqueue } from "../../../lib/safety/runtimeDecision";
import { isAgeExemptPath, proxy, safeAgeReturnPath } from "../../../proxy";

const migration = readFileSync("supabase/migrations/20260906110000_phase11_legal_safety_cases.sql", "utf8");
const adminRoute = readFileSync("app/api/admin/safety/cases/[caseRef]/route.ts", "utf8");
const ui = readFileSync("app/admin/safety/SafetyQueueClient.tsx", "utf8");
const report = (body: unknown, headers: Record<string,string> = {}) => new Request("https://app.invalid/api/safety/reports", { method:"POST", headers:{"content-type":"application/json",...headers}, body:typeof body==="string"?body:JSON.stringify(body) });
const valid = { category:"GENERAL_COMPLAINT", reporterType:"WITNESS_OTHER", description:"Synthetic text-only complaint with sufficient detail.", goodFaith:true };

test("proxy behavior enforces adult pages and exempts every legal/infrastructure path", async () => {
  const gated = await proxy(new NextRequest("https://app.invalid/?q=1"));
  assert.equal(gated.status,307); assert.equal(gated.headers.get("location"),"https://app.invalid/age?next=%2F%3Fq%3D1");
  const admitted = await proxy(new NextRequest("https://app.invalid/",{headers:{cookie:"sf_age_attested=1"}})); assert.equal(admitted.status,200);
  for(const path of ["/age","/terms","/privacy","/acceptable-use","/underage-policy","/complaints","/content-removal","/report-intimate-content","/dmca","/2257-exemption","/contact","/_next/static/a.js","/auth/callback","/api/age-attestation","/api/safety/reports","/api/webhook/payment-v2","/api/internal/example","/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/x","/.well-known/vercel/rate-limit-api/x"]) {
    assert.equal(isAgeExemptPath(path),true,path);
  }
  assert.equal(isAgeExemptPath("/api/generate"),false); assert.equal(isAgeExemptPath("/generate"),false);
  for(const unsafe of ["//evil.example","https://evil.example/x","not-a-path","/%"] ) assert.equal(safeAgeReturnPath(unsafe),"/");
  assert.equal(safeAgeReturnPath("/generate?q=1"),"/generate?q=1");
});

test("age POST requires explicit same-origin attestation and issues hardened cookie", async () => {
  const request=(body:string,headers:Record<string,string>={})=>new Request("https://app.invalid/api/age-attestation",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",origin:"https://app.invalid",...headers},body});
  assert.equal((await attest(request("next=%2F"))).status,400);
  assert.equal((await attest(request("attest=no&next=%2F"))).status,400);
  assert.equal((await attest(request("attest=18plus&attest=18plus"))).status,400);
  assert.equal((await attest(request("attest=18plus&extra=x"))).status,400);
  assert.equal((await attest(request("attest=18plus",{origin:"https://evil.example"}))).status,403);
  assert.equal((await attest(request("attest=18plus",{"sec-fetch-site":"cross-site"}))).status,403);
  const response=await attest(request("attest=18plus&next=%2Fgenerate"));assert.equal(response.status,303);assert.equal(response.headers.get("location"),"https://app.invalid/generate");
  const cookie=response.headers.get("set-cookie")??"";assert.match(cookie,/sf_age_attested=1/);assert.match(cookie,/HttpOnly/i);assert.match(cookie,/SameSite=Lax/i);assert.match(cookie,/Max-Age=15552000/i);
});

test("public report handler behavior rejects malformed and unsafe requests", async () => {
  const create=async()=>"SF-SAF-20260906-00000001";
  assert.equal((await handleSafetyReport(new Request("https://app.invalid",{method:"POST",body:"x"}),create)).status,415);
  assert.equal((await handleSafetyReport(report(valid,{"content-length":"16385"}),create)).status,413);
  assert.equal((await handleSafetyReport(report("x".repeat(16385)),create)).status,413);
  assert.equal((await handleSafetyReport(report("{"),create)).status,400);
  for(const body of [[],{...valid,unknown:true},{...valid,category:"BAD"},{...valid,reporterType:"BAD"},{...valid,contactEmail:"bad"},{...valid,contentUrl:"javascript:bad"},{...valid,description:"short"},{...valid,description:"Synthetic valid text\nwith control"},{...valid,goodFaith:false},{...valid,goodFaith:undefined},{...valid,category:"NCII"},{...valid,category:"NCII",affectedPersonDeclaration:"WITNESS_OTHER"}]) assert.equal((await handleSafetyReport(report(body),create)).status,400,JSON.stringify(body));
});

test("public report success is acknowledgement-only and outages are generic", async () => {
  const response=await handleSafetyReport(report(valid),async()=>"SF-SAF-20260906-00000001");assert.equal(response.status,201);assert.deepEqual(await response.json(),{ok:true,caseReference:"SF-SAF-20260906-00000001"});assert.equal(response.headers.get("cache-control"),"no-store");
  for(const create of [async()=>null,async()=>{throw new Error("raw secret database failure")}]){const unavailable=await handleSafetyReport(report(valid),create);assert.equal(unavailable.status,503);const text=await unavailable.text();assert.doesNotMatch(text,/secret|database|stack/i);}
});

test("migration integrates finite chronology, closure, capability and RLS contracts",()=>{
  assert.doesNotMatch(migration,/\('founder_admin','safety\.case\.read',statement_timestamp/);
  for(const token of ["SAFETY_CHRONOLOGY_APPEND_ONLY","list_admin_safety_case_activities","SAFETY_CLOSURE_OUTCOME_REQUIRED","force row level security","on delete set null","order by a.sequence_no desc limit p_limit"]) assert.match(migration,new RegExp(token,"i"));
  assert.doesNotMatch(migration,/support_operator','safety|security_operator','safety/);
  assert.match(migration,/create table public\.safety_case_activities[\s\S]*outcome_summary text check/);
  assert.match(migration,/insert into public\.safety_case_activities\(case_id,actor_user_id,actor_kind,activity_type,from_state,to_state,reason_code,reason,outcome_summary\)/);
  assert.doesNotMatch(migration,/insert into public\.safety_case_activities\([^)]*safe_reference[^)]*\)[\s\S]{0,500}p_outcome_summary/);
  assert.doesNotMatch(migration,/left\(c\.description/);
  for(const summary of ["Reference and URL supplied","Reference supplied","URL supplied","No location reference supplied"]) assert.match(migration,new RegExp(summary));
  for(const token of ["NEXT_STATES","QUEUE_PAGE_SIZE","QUEUE_FETCH_SIZE","HISTORY_PAGE_SIZE","HISTORY_FETCH_SIZE","Load older cases","Load older history","before_id","before_sequence","outcome_summary","Newest first"]) assert.match(ui,new RegExp(token));
  assert.match(ui,/Closure outcome: \{activity\.outcome_summary\}/);
  assert.doesNotMatch(ui,/Closure outcome: \{activity\.safe_reference\}/);
});

test("Postgres runner is destructive only against exact disposable database and uses real prerequisites",()=>{
  const runner=readFileSync("backend/governance/tests/runPhase11LegalSafetyPostgres.mjs","utf8");
  for(const prerequisite of ["phase10PostgresSetup.sql","20260905060000_phase8_governance_foundation.sql","20260906070000_phase10_admin_support_security.sql","20260906093000_phase10_support_resolution_message.sql","20260906110000_phase11_legal_safety_cases.sql"]) assert.match(runner,new RegExp(prerequisite));
  assert.doesNotMatch(runner,/create table public\.admin_roles|create function public\.append_governance_audit_event/);
  const unsafe=spawnSync(process.execPath,["backend/governance/tests/runPhase11LegalSafetyPostgres.mjs"],{encoding:"utf8",env:{...process.env,PHASE11_DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/postgres"}});
  assert.equal(unsafe.status,2);assert.match(unsafe.stderr,/Refusing to run/);
});

test("admin RPC errors map to finite safe HTTP classes",()=>{
  assert.equal(classifySafetyRpcError("SAFETY_NOT_FOUND"),"not_found");assert.equal(classifySafetyRpcError("SAFETY_TRANSITION_INVALID"),"invalid_transition");assert.equal(classifySafetyRpcError("connection secret detail"),"unavailable");
  assert.match(adminRoute,/kind === "not_found"[\s\S]*404/);assert.match(adminRoute,/kind === "invalid_transition"[\s\S]*409/);assert.match(adminRoute,/kind === "unavailable"[\s\S]*503/);assert.doesNotMatch(adminRoute,/error\.message|error\.details/);
});

test("runtime safety remains a future fail-closed activation contract, not a classifier",()=>{
  assert.throws(()=>assertRuntimeSafetyAllowsEnqueue(null),/RUNTIME_SAFETY/);assert.throws(()=>assertRuntimeSafetyAllowsEnqueue({decision:"REVIEW",policyVersion:"v1",decisionId:"d",decidedAt:new Date().toISOString()}),/RUNTIME_SAFETY/);assert.doesNotThrow(()=>assertRuntimeSafetyAllowsEnqueue({decision:"ALLOW",policyVersion:"v1",decisionId:"synthetic",decidedAt:new Date().toISOString()}));
});
