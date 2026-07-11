import type { AutopostPlanSuccess, JobState, PlanStatus, PublishingMode, SafeCapability } from "./types"

const uuidFull = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const dec = /^[1-9]\d*$/
const hash = /^[a-f0-9]{64}$/
const platformId = /^[a-z0-9_][a-z0-9_-]{0,63}$/
const rfc3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/
const planStatuses = new Set<PlanStatus>(["draft","scheduled","in_progress","partially_published","completed","completed_with_failures","cancelled"])
const jobStates = new Set<JobState>(["draft","ready_to_publish","direct_publish_queued","publishing_direct","published_direct","direct_publish_failed","retry_scheduled","authentication_required","platform_rejected","scheduled_internally","awaiting_operator","due_now","claimed","scheduled_on_platform","awaiting_post_confirmation","confirmed_posted_manual","failed_manual_upload","needs_fix","skipped","blocked","archived","package_ready","ready_for_export","exported"])
const modes = new Set<PublishingMode>(["direct","assisted","planner","disabled"])
const availability = new Set<SafeCapability["availabilityStatus"]>(["available","unassigned","disabled","frozen"])

function str(v: unknown){ if(typeof v !== "string" || !v.trim()) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE"); return v }
function uuidStr(v: unknown){ const s = str(v); if(!uuidFull.test(s)) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE"); return s }
function isLeapYear(y: number){ return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) }
function daysInMonth(y: number, m: number){ return m === 2 ? (isLeapYear(y) ? 29 : 28) : [4,6,9,11].includes(m) ? 30 : 31 }
function tsStr(v: unknown){
  const s = str(v)
  const match = rfc3339.exec(s)
  if(!match) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE")
  const [, yy, mm, dd, hh, min, sec, , sign, offH, offM] = match
  const year = Number(yy), month = Number(mm), day = Number(dd), hour = Number(hh), minute = Number(min), second = Number(sec)
  if(month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE")
  if(sign){ const oh = Number(offH), om = Number(offM); if(oh > 23 || om > 59) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE") }
  const d = new Date(s)
  if(!Number.isFinite(d.getTime())) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE")
  return s
}
function bool(v: unknown){ if(typeof v !== "boolean") throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE"); return v }
function auditStr(v: unknown){ if(typeof v !== "string" || !dec.test(v)) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE"); return v }
function hashStr(v: unknown){ const s = str(v); if(!hash.test(s)) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE"); return s }
function platformStr(v: unknown){ const s = str(v); if(!platformId.test(s)) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE"); return s }
function labelFor(mode: PublishingMode){ return mode === "direct" ? "Direct autopost available" : mode === "assisted" ? "Assisted publish required" : mode === "planner" ? "Planner/export only" : "Unavailable" }

export function toSafeCapabilities(rows: any[]): SafeCapability[]{
  const seen = new Set<string>()
  let registryVersion: string | null = null
  return rows.map((r) => {
    const platform = platformStr(r.platform)
    if(seen.has(platform)) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE")
    seen.add(platform)
    const publishingMode = str(r.publishing_mode) as PublishingMode
    const availabilityStatus = str(r.availability_status) as SafeCapability["availabilityStatus"]
    const version = str(r.registry_version)
    if(registryVersion && registryVersion !== version) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE")
    registryVersion = version
    if(!modes.has(publishingMode) || !availability.has(availabilityStatus)) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE")
    if((availabilityStatus === "available" && publishingMode === "disabled") || (availabilityStatus !== "available" && publishingMode !== "disabled")) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE")
    return { platform, registryVersion: version, displayName: str(r.display_name), publishingMode, availabilityStatus, humanPublishingRequired: bool(r.human_publishing_required), connectorCanPublishImmediately: bool(r.connector_can_publish_immediately), connectorCanScheduleDirectly: bool(r.connector_can_schedule_directly), connectorCanUploadMedia: bool(r.connector_can_upload_media), humanOperatorQueueSupported: bool(r.human_operator_queue_supported), safeLabel: str(r.safe_label), safeDescription: str(r.safe_description) }
  })
}

export function parseCreateAutopostPlanRpcResult(data: any, expectedCreatorId: string, requestedPackageIds: string[]): AutopostPlanSuccess {
  if(!data || typeof data !== "object") throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE")
  const plan = data.plan
  const rawJobs = Array.isArray(data.jobs) ? data.jobs : []
  const topAudit = data.audit_event_ids
  const registryVersion = str(data.registry_version)
  const planId = uuidStr(plan?.id)
  if(str(plan?.creator_id) !== expectedCreatorId) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE")
  const status = str(plan?.status) as PlanStatus
  if(!planStatuses.has(status) || str(plan?.registry_version) !== registryVersion) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE")
  const planAudit = auditStr(plan?.original_plan_audit_event_id)
  if(auditStr(topAudit?.plan) !== planAudit) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE")
  const planJobAudits = (Array.isArray(plan?.original_job_audit_event_ids) ? plan.original_job_audit_event_ids : []).map(auditStr)
  const topJobAudits = (Array.isArray(topAudit?.jobs) ? topAudit.jobs : []).map(auditStr)
  if(JSON.stringify(planJobAudits) !== JSON.stringify(topJobAudits)) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE")
  const allAudits = [planAudit, ...planJobAudits]
  if(new Set(allAudits).size !== allAudits.length) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE")
  const requested = new Set(requestedPackageIds)
  const jobIds = new Set<string>(), packageIds = new Set<string>(), accountIds = new Set<string>()
  const jobs = rawJobs.map((j: any) => {
    const id = uuidStr(j.id)
    const contentPackageId = uuidStr(j.content_package_id)
    const accountId = uuidStr(j.platform_account_id)
    if(jobIds.has(id) || packageIds.has(contentPackageId) || accountIds.has(accountId) || !requested.has(contentPackageId)) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE")
    jobIds.add(id); packageIds.add(contentPackageId); accountIds.add(accountId)
    if(uuidStr(j.publishing_plan_id) !== planId || str(j.creator_id) !== expectedCreatorId) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE")
    const targetPlatform = platformStr(j.target_platform)
    const publishingMode = str(j.publishing_mode) as PublishingMode
    const jobState = str(j.job_state) as JobState
    if(!modes.has(publishingMode) || !jobStates.has(jobState) || str(j.capability_registry_version) !== registryVersion || publishingMode === "disabled" || targetPlatform === "fanvue") throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE")
    hashStr(j.source_package_fingerprint)
    const auditId = auditStr(j.original_job_audit_event_id)
    return { id, publishingPlanId: planId, contentPackageId, platformAccountId: accountId, targetPlatform, platformLabel: str(j.platform_label ?? j.target_platform), publishingMode, publishingModeLabel: labelFor(publishingMode), jobState, originalJobAuditEventId: auditId, createdAt: tsStr(j.created_at), updatedAt: tsStr(j.updated_at) }
  })
  const idempotent = bool(data.idempotent)
  if(jobs.length !== requested.size || packageIds.size !== requested.size || planJobAudits.length !== jobs.length || jobs.some(j => !planJobAudits.includes(j.originalJobAuditEventId))) throw new Error("AUTOPOST_MALFORMED_TRUSTED_RESPONSE")
  return { ok: true, plan: { id: planId, status, registryVersion, originalPlanAuditEventId: planAudit, originalJobAuditEventIds: planJobAudits, createdAt: tsStr(plan.created_at), updatedAt: tsStr(plan.updated_at) }, jobs, auditEventIds: { plan: planAudit, jobs: planJobAudits }, registryVersion, idempotent }
}
