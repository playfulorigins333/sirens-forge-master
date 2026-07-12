import { createHash } from "node:crypto"
import { AI_TWIN_CONSENT_VERSION } from "../consent/copy"
import { getAiTwinConsentTextSha256 } from "../consent/hash"

export const terminalJobStates = new Set(["published_direct","confirmed_posted_manual","exported","direct_publish_failed","failed_manual_upload","skipped","blocked","platform_rejected","archived"])
export const safeGateCodes = new Set(["OK","JOB_NOT_FOUND","PLAN_OWNERSHIP_INVALID","PACKAGE_OWNERSHIP_INVALID","DESTINATION_ACCOUNT_INVALID","CAPABILITY_NOT_FOUND","CAPABILITY_SNAPSHOT_STALE","PLATFORM_UNAVAILABLE","FANVUE_NOT_AVAILABLE","COMPLIANCE_BLOCKED","COMPLIANCE_CURRENT_EVIDENCE_REQUIRED","COMPLIANCE_LATER_BLOCKING_REVIEW","COMPLIANCE_NOT_PASSED","CREATOR_APPROVAL_REQUIRED","CREATOR_VERIFICATION_REQUIRED","DESTINATION_ACCOUNT_VERIFICATION_REQUIRED","DESTINATION_ACCOUNT_VERIFICATION_REVOKED","AI_TWIN_CONSENT_REQUIRED","AI_TWIN_CONSENT_POLICY_STALE","AI_TWIN_CONSENT_HASH_INVALID","CO_PERFORMER_RELEASE_REQUIRED","MEDIA_REQUIRED","GENERATED_MEDIA_PROVENANCE_REQUIRED","STALE_SOURCE_FINGERPRINT","ACTIVE_QUEUE_TASK_CONFLICT","ACTIVE_PUBLICATION_JOB_CONFLICT","TERMINAL_JOB"])
export type SchedulerGenerationFact={id:string;userId:string;status:string;r2Bucket?:string;r2Key?:string;metadata?:Record<string,unknown>}
export type SchedulerMediaFact={source:string;generationId?:string;storageKey?:string;mimeType?:string;sha256?:string;generation?:SchedulerGenerationFact|null}
export type SchedulerComplianceReviewFact={id:string;reviewSource:"automated"|"human"|string;outcome:string;compliancePolicyVersion?:string|null;reason?:string|null;createdAt:string}
export type SchedulerQueueTaskFact={id?:string;creatorId:string;contentPackageId:string;targetPlatform:string;platformAccountId:string;status:string}
export type SchedulerGateFacts={creatorId:string;profileId?:string;jobState:string;planOk:boolean;packageOk:boolean;accountOk:boolean;targetPlatform:string;publishingMode:string;platformAccountId?:string;contentPackageId?:string;capability:{available:boolean;mode:string;registryVersionMatches:boolean;requiresTrustedAccountVerification?:boolean;connectorCanPublishImmediately?:boolean};package:{complianceStatus:string;creatorApprovalStatus:string;creatorApprovedAt?:string|null;creatorApprovedBy?:string|null;aiFlag?:string;secondPersonPresent?:boolean;compliancePolicyVersion?:string|null};complianceReviews?:SchedulerComplianceReviewFact[];latestHumanReview?:{outcome?:string;reason?:string;resolved?:boolean}|null;creatorVerificationStatus?:string;accountVerificationStatus?:string;aiTwinConsent?:{creatorId?:string;status?:string;revokedAt?:string|null;attestationVersion?:string|null;attestationTextSha256?:string|null}|null;coPerformers?:{platformReleaseConfirmed?:boolean;releaseDocumentReference?:string|null}[];media:SchedulerMediaFact[];sourceIsCurrent:boolean;queueTasks?:SchedulerQueueTaskFact[];activeQueueConflict?:boolean;activePublicationJobConflict?:boolean}
export type GateResult={ok:boolean;code:string;hard:boolean}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const sha=/^[a-f0-9]{64}$/i
const terminalQueueStates=new Set(["confirmed_posted_manual","skipped","failed_manual_upload","blocked","archived"])
function unsafe(metadata:Record<string,unknown>|undefined){return metadata?.placeholder===true||metadata?.is_placeholder===true||metadata?.test===true||metadata?.is_test===true||metadata?.unsafe===true||String(metadata?.safety??metadata?.safety_classification??"").toLowerCase()==="unsafe"}
function later(a:SchedulerComplianceReviewFact,b:SchedulerComplianceReviewFact){return a.createdAt>b.createdAt||(a.createdAt===b.createdAt&&a.id>b.id)}
function newest(reviews:SchedulerComplianceReviewFact[]){return [...reviews].sort((a,b)=>a.createdAt===b.createdAt?b.id.localeCompare(a.id):b.createdAt.localeCompare(a.createdAt))[0]}
function complianceResult(f:SchedulerGateFacts):GateResult|null{
  const status=f.package.complianceStatus
  if(status==="blocked")return {ok:false,code:"COMPLIANCE_BLOCKED",hard:true}
  if(!["passed","escalated_approved"].includes(status))return {ok:false,code:"COMPLIANCE_NOT_PASSED",hard:false}
  const version=String(f.package.compliancePolicyVersion??"")
  const reviews=f.complianceReviews??[]
  const evidence=newest(reviews.filter(r=>r.compliancePolicyVersion===version&&(status==="passed"?(r.reviewSource==="automated"&&r.outcome==="pass"):(r.reviewSource==="human"&&r.outcome==="escalate"&&String(r.reason??"").trim().length>0))))
  if(!evidence)return {ok:false,code:"COMPLIANCE_CURRENT_EVIDENCE_REQUIRED",hard:false}
  const blocking=newest(reviews.filter(r=>(r.outcome==="block"||r.outcome==="manual_review")&&later(r,evidence)))
  if(blocking)return {ok:false,code:"COMPLIANCE_LATER_BLOCKING_REVIEW",hard:blocking.outcome==="block"}
  return null
}
export function classifyLegacyQueueCompatibility(f:Pick<SchedulerGateFacts,"creatorId"|"contentPackageId"|"targetPlatform"|"platformAccountId"|"queueTasks">):{ok:boolean;code:"OK"|"ACTIVE_QUEUE_TASK_CONFLICT";compatibleLegacyQueueTask?:SchedulerQueueTaskFact}{
  const nonterminal=(f.queueTasks??[]).filter(q=>!terminalQueueStates.has(q.status))
  if(nonterminal.length===0)return {ok:true,code:"OK"}
  if(nonterminal.length>1)return {ok:false,code:"ACTIVE_QUEUE_TASK_CONFLICT"}
  const q=nonterminal[0]
  if(q.status==="ready_for_handoff"&&q.creatorId===f.creatorId&&q.contentPackageId===f.contentPackageId&&q.targetPlatform===f.targetPlatform&&q.platformAccountId===f.platformAccountId)return {ok:true,code:"OK",compatibleLegacyQueueTask:{...q}}
  return {ok:false,code:"ACTIVE_QUEUE_TASK_CONFLICT"}
}
export function evaluateSchedulerGateFacts(f:SchedulerGateFacts):GateResult{
  if(!f.planOk)return {ok:false,code:"PLAN_OWNERSHIP_INVALID",hard:true}
  if(!f.packageOk)return {ok:false,code:"PACKAGE_OWNERSHIP_INVALID",hard:true}
  if(!f.accountOk)return {ok:false,code:"DESTINATION_ACCOUNT_INVALID",hard:true}
  if(terminalJobStates.has(f.jobState))return {ok:false,code:"TERMINAL_JOB",hard:true}
  if(!f.capability.registryVersionMatches)return {ok:false,code:"CAPABILITY_SNAPSHOT_STALE",hard:false}
  if(!f.capability.available||f.capability.mode==="disabled"||f.publishingMode==="disabled")return {ok:false,code:"PLATFORM_UNAVAILABLE",hard:true}
  if(f.targetPlatform==="fanvue")return {ok:false,code:"FANVUE_NOT_AVAILABLE",hard:true}
  const compliance=complianceResult(f); if(compliance)return compliance
  if(f.package.creatorApprovalStatus!=="approved"||!f.package.creatorApprovedAt||!f.package.creatorApprovedBy)return {ok:false,code:"CREATOR_APPROVAL_REQUIRED",hard:false}
  if(f.creatorVerificationStatus!=="verified")return {ok:false,code:"CREATOR_VERIFICATION_REQUIRED",hard:false}
  if(f.accountVerificationStatus==="revoked")return {ok:false,code:"DESTINATION_ACCOUNT_VERIFICATION_REVOKED",hard:true}
  if(f.capability.requiresTrustedAccountVerification?f.accountVerificationStatus!=="verified":!["verified","creator_attested"].includes(String(f.accountVerificationStatus)))return {ok:false,code:"DESTINATION_ACCOUNT_VERIFICATION_REQUIRED",hard:false}
  if(["ai_enhanced","ai_generated"].includes(String(f.package.aiFlag??""))){
    const consent=f.aiTwinConsent
    if(!consent||consent.creatorId&&consent.creatorId!==f.creatorId||consent.status!=="granted"||consent.revokedAt!=null)return {ok:false,code:"AI_TWIN_CONSENT_REQUIRED",hard:false}
    if(String(consent.attestationVersion??"").trim()!==AI_TWIN_CONSENT_VERSION)return {ok:false,code:"AI_TWIN_CONSENT_POLICY_STALE",hard:false}
    const expectedHash=getAiTwinConsentTextSha256()
    const actualHash=String(consent.attestationTextSha256??"").trim().toLowerCase()
    if(!sha.test(actualHash)||actualHash!==expectedHash)return {ok:false,code:"AI_TWIN_CONSENT_HASH_INVALID",hard:false}
  }
  if(f.package.secondPersonPresent){ if(!f.coPerformers?.length)return {ok:false,code:"CO_PERFORMER_RELEASE_REQUIRED",hard:false}; if(f.coPerformers.some(r=>r.platformReleaseConfirmed!==true||!String(r.releaseDocumentReference??"").trim()))return {ok:false,code:"CO_PERFORMER_RELEASE_REQUIRED",hard:false} }
  if(f.media.length===0)return {ok:false,code:"MEDIA_REQUIRED",hard:false}
  if(f.media.some(m=>m.source!=="ai_pipeline"||!uuid.test(String(m.generationId??""))||!m.generation||![f.creatorId,f.profileId].includes(m.generation.userId)||m.generation.status!=="completed"||!String(m.generation.r2Bucket??"").trim()||!String(m.generation.r2Key??"").trim()||!String(m.storageKey??"").trim()||!String(m.mimeType??"").trim()||!sha.test(String(m.sha256??""))||unsafe(m.generation.metadata)))return {ok:false,code:"GENERATED_MEDIA_PROVENANCE_REQUIRED",hard:true}
  if(!f.sourceIsCurrent)return {ok:false,code:"STALE_SOURCE_FINGERPRINT",hard:false}
  const queue=classifyLegacyQueueCompatibility(f); if(!queue.ok)return {ok:false,code:"ACTIVE_QUEUE_TASK_CONFLICT",hard:true}
  if(f.activeQueueConflict)return {ok:false,code:"ACTIVE_QUEUE_TASK_CONFLICT",hard:true}
  if(f.activePublicationJobConflict)return {ok:false,code:"ACTIVE_PUBLICATION_JOB_CONFLICT",hard:true}
  return {ok:true,code:"OK",hard:false}
}
function stable(value:unknown):unknown{ if(Array.isArray(value)) return value.map(stable); if(value&&typeof value==="object") return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])); return value }
export function stableScheduleRequestFingerprint(input:{creatorId:string;planId:string;targetJobIds:string[];intendedPublishAt:string;scheduleTimezone:string;actionType:"schedule"|"reschedule";expectedScheduleRevisions?:Record<string,number>;assistedLeadPolicyVersion?:string}){ return createHash("sha256").update(JSON.stringify(stable({...input,targetJobIds:[...new Set(input.targetJobIds)].sort(),expectedScheduleRevisions:input.expectedScheduleRevisions??{},assistedLeadPolicyVersion:input.assistedLeadPolicyVersion??"task15_60_minutes_v1"}))).digest("hex") }
export function stableTrustedSnapshotFingerprint(snapshot:unknown){ return createHash("sha256").update(JSON.stringify(stable(snapshot))).digest("hex") }
export function compareIdempotencyRecord(record:{requestFingerprint:string;result:unknown}|null,fingerprint:string){ if(!record)return {kind:"new" as const}; return record.requestFingerprint===fingerprint?{kind:"replay" as const,result:record.result}:{kind:"conflict" as const,code:"IDEMPOTENCY_CONFLICT"} }
export function normalizeExpectedRevisionMap(value:unknown,targetJobIds:string[],required:boolean){ if(value==null){ if(required) throw new Error("EXPECTED_REVISIONS_REQUIRED"); return {} as Record<string,number> } if(typeof value!=="object"||Array.isArray(value)) throw new Error("EXPECTED_REVISIONS_REQUIRED"); const out:Record<string,number>={}; const keys=Object.keys(value as Record<string,unknown>); const targets=new Set(targetJobIds); for(const k of keys){ if(!targets.has(k)) throw new Error("UNEXPECTED_REVISION_JOB"); const n=(value as Record<string,unknown>)[k]; if(!Number.isInteger(n)||Number(n)<0||Number(n)>1_000_000) throw new Error("INVALID_EXPECTED_REVISION"); out[k]=Number(n) } if(required&&targetJobIds.some(id=>out[id]===undefined)) throw new Error("EXPECTED_REVISIONS_REQUIRED"); return out }
export type SchedulerProcessorClassification="processed"|"blocked"|"skipped"|"failed"
export function classifySchedulerProcessorResult(data:unknown):SchedulerProcessorClassification{ if(!data||typeof data!=="object"||Array.isArray(data))return "failed"; const r=data as Record<string,unknown>; if(r.blocked===true)return "blocked"; if(r.skipped===true)return "skipped"; if(r.processed===true&&r.ok===true)return "processed"; if(r.failed===true||r.ok===false)return "failed"; return "failed" }

export function schedulerHttpStatusForErrorCode(code:string){ if(code==="UNAUTHENTICATED")return 401; if(code==="AUTOPOST_SCHEMA_UNAVAILABLE")return 503; if(["IDEMPOTENCY_CONFLICT","STALE_SCHEDULE_REVISION","PLAN_CANCELLED"].includes(code))return 409; if(["SCHEDULE_FAILED","MALFORMED_TRUSTED_RESPONSE"].includes(code))return 500; return 400 }
export function parseSchedulerTrustedIso(value:unknown){ if(value==null)return null; if(typeof value!=="string") throw Object.assign(new Error("MALFORMED_TRUSTED_RESPONSE"),{code:"MALFORMED_TRUSTED_RESPONSE"}); try{ const date=new Date(value); const iso=date.toISOString(); if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(iso)) throw new Error("bad timestamp"); return iso }catch{ throw Object.assign(new Error("MALFORMED_TRUSTED_RESPONSE"),{code:"MALFORMED_TRUSTED_RESPONSE"}) } }
