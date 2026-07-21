import { createHash, timingSafeEqual } from "node:crypto"
import { AI_TWIN_CONSENT_VERSION } from "../consent/copy"
import { getAiTwinConsentTextSha256 } from "../consent/hash"

export const CREATOR_PUBLISHING_SCHEDULER_BUILD_ENABLED = true as const
export const CREATOR_PUBLISHING_SCHEDULER_CLAIM_LIMIT = 1 as const
export const CREATOR_PUBLISHING_SCHEDULER_LOCK_MINUTES = 15 as const

type HeaderMap = { get(name: string): string | null }
type RpcResult = { data: unknown; error: unknown }
type SchedulerEventReconciliationQuery = {
  select(projection: "status,processed_at,superseded_at,safe_error_code,lock_token,locked_at"): { eq(column: "id", value: string): { limit(count: 1): Promise<RpcResult> } }
}
export type SchedulerAdminClient = { rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>; from?(table: "creator_publishing_scheduler_events"): SchedulerEventReconciliationQuery }

export type SchedulerRunResult =
  | { ok: false; code: "CRON_SECRET_NOT_CONFIGURED" | "UNAUTHORIZED" | "SCHEDULER_BUILD_DISABLED" | "SCHEDULER_ENV_DISABLED" | "SCHEDULER_SERVICE_UNAVAILABLE" }
  | { ok: true; code: "SCHEDULER_RUN_COMPLETED"; claimedCount: number; attemptedCount: number; processedCount: number; blockedCount: number; supersededCount: number }
  | { ok: false; code: "CLAIM_RPC_FAILED" | "CLAIM_RESPONSE_INVALID" | "PROCESS_RPC_FAILED" | "PROCESS_RESPONSE_INVALID" | "UNKNOWN_SAFE_ERROR_CODE" | "STALE_LOCK_TOKEN" | "EVENT_NOT_FOUND" | "IDENTITY_MISMATCH"; claimedCount: number; attemptedCount: number; processedCount: number; blockedCount: number; supersededCount: number }

type ClaimedSchedulerEvent = { event_id: string; lock_token: string }
type Counts = { claimedCount: number; attemptedCount: number; processedCount: number; blockedCount: number; supersededCount: number }
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const processedStates = new Set(["awaiting_operator", "due_now", "direct_publish_queued", "ready_for_export"])
export const SCHEDULER_SAFE_ERROR_CODES = ["PLATFORM_UNAVAILABLE","FANVUE_NOT_AVAILABLE","DESTINATION_ACCOUNT_REVOKED","DESTINATION_ACCOUNT_NOT_VERIFIED","CREATOR_VERIFICATION_MISSING","AI_TWIN_CONSENT_MISSING","CREATOR_APPROVAL_MISSING","COMPLIANCE_EVIDENCE_INVALID","CO_PERFORMER_RELEASE_MISSING","ACTIVE_QUEUE_TASK_CONFLICT","SOURCE_FINGERPRINT_STALE","ACTIVE_PUBLICATION_JOB_CONFLICT","SCHEDULER_STATE_TRANSITION_INVALID"] as const
const safeErrors = new Set<string>(SCHEDULER_SAFE_ERROR_CODES)
const jobStates = new Set(["draft","ready_to_publish","direct_publish_queued","publishing_direct","published_direct","direct_publish_failed","retry_scheduled","authentication_required","platform_rejected","scheduled_internally","awaiting_operator","due_now","claimed","scheduled_on_platform","awaiting_post_confirmation","confirmed_posted_manual","failed_manual_upload","needs_fix","skipped","blocked","archived","package_ready","ready_for_export","exported"])

function isPlainObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype }
function keysAre(value: Record<string, unknown>, keys: string[]) { const actual = Object.keys(value).sort(); return actual.length === keys.length && keys.slice().sort().every((k, i) => actual[i] === k) }
function digest(value: string) { return createHash("sha256").update(value, "utf8").digest() }
function secretMatches(candidate: string, configured: string) { return timingSafeEqual(digest(candidate), digest(configured)) }
function parseBearer(value: string) { const match = /^Bearer ([^\s]+)$/.exec(value); return match?.[1] ?? null }

export function authenticateSchedulerRequest(headers: HeaderMap, configuredSecret: string | undefined): SchedulerRunResult | { ok: true } {
  if (!configuredSecret) return { ok: false, code: "CRON_SECRET_NOT_CONFIGURED" }
  const auth = headers.get("authorization")
  const cron = headers.get("x-vercel-cron-secret")
  if (auth === null && cron === null) return { ok: false, code: "UNAUTHORIZED" }
  const candidates: string[] = []
  if (auth !== null) { const bearer = parseBearer(auth); if (!bearer) return { ok: false, code: "UNAUTHORIZED" }; candidates.push(bearer) }
  if (cron !== null) { if (cron.length === 0) return { ok: false, code: "UNAUTHORIZED" }; candidates.push(cron) }
  return candidates.every((candidate) => secretMatches(candidate, configuredSecret)) ? { ok: true } : { ok: false, code: "UNAUTHORIZED" }
}

export function parseClaimSchedulerEvents(data: unknown): { ok: true; events: ClaimedSchedulerEvent[] } | { ok: false } {
  if (!Array.isArray(data) || data.length > CREATOR_PUBLISHING_SCHEDULER_CLAIM_LIMIT) return { ok: false }
  const eventIds = new Set<string>(), rows = new Set<string>(); const events: ClaimedSchedulerEvent[] = []
  for (const item of data) {
    if (!isPlainObject(item) || !keysAre(item, ["event_id", "lock_token"])) return { ok: false }
    const { event_id, lock_token } = item
    if (typeof event_id !== "string" || typeof lock_token !== "string" || !uuidRe.test(event_id) || !uuidRe.test(lock_token)) return { ok: false }
    const rowKey = `${event_id}:${lock_token}`
    if (eventIds.has(event_id) || rows.has(rowKey)) return { ok: false }
    eventIds.add(event_id); rows.add(rowKey); events.push({ event_id, lock_token })
  }
  return { ok: true, events }
}

type ProcessParse = { ok: true; kind: "processed" | "blocked" | "superseded" } | { ok: false; code: "STALE_LOCK_TOKEN" | "EVENT_NOT_FOUND" | "IDENTITY_MISMATCH" | "UNKNOWN_SAFE_ERROR_CODE" | "PROCESS_RESPONSE_INVALID" }
export function parseProcessSchedulerEvent(data: unknown): ProcessParse {
  if (!isPlainObject(data)) return { ok: false, code: "PROCESS_RESPONSE_INVALID" }
  if (data.ok === false && keysAre(data, ["ok", "code"]) && ["STALE_LOCK_TOKEN", "EVENT_NOT_FOUND", "IDENTITY_MISMATCH"].includes(String(data.code))) return { ok: false, code: data.code as "STALE_LOCK_TOKEN" | "EVENT_NOT_FOUND" | "IDENTITY_MISMATCH" }
  if (data.ok !== true || typeof data.status !== "string") return { ok: false, code: "PROCESS_RESPONSE_INVALID" }
  if (data.status === "processed") return keysAre(data, ["ok", "status", "job_state"]) && typeof data.job_state === "string" && processedStates.has(data.job_state) ? { ok: true, kind: "processed" } : { ok: false, code: "PROCESS_RESPONSE_INVALID" }
  if (data.status === "blocked") {
    if (!keysAre(data, ["ok", "status", "safe_error_code"]) || typeof data.safe_error_code !== "string") return { ok: false, code: "PROCESS_RESPONSE_INVALID" }
    return safeErrors.has(data.safe_error_code) ? { ok: true, kind: "blocked" } : { ok: false, code: "UNKNOWN_SAFE_ERROR_CODE" }
  }
  if (data.status === "superseded") {
    if (data.code === "OBSOLETE_OPERATOR_DUE_SUPERSEDED") return keysAre(data, ["ok", "status", "code"]) ? { ok: true, kind: "superseded" } : { ok: false, code: "PROCESS_RESPONSE_INVALID" }
    if (data.code === "JOB_TERMINAL") return keysAre(data, ["ok", "status", "code", "job_state"]) && typeof data.job_state === "string" && jobStates.has(data.job_state) ? { ok: true, kind: "superseded" } : { ok: false, code: "PROCESS_RESPONSE_INVALID" }
    if (data.code === "SCHEDULER_STALE_REVISION") {
      const validRevision = data.schedule_revision === null || (Number.isInteger(data.schedule_revision) && Number(data.schedule_revision) > 0)
      return keysAre(data, ["ok", "status", "code", "job_state", "schedule_revision"]) && typeof data.job_state === "string" && jobStates.has(data.job_state) && validRevision ? { ok: true, kind: "superseded" } : { ok: false, code: "PROCESS_RESPONSE_INVALID" }
    }
  }
  return { ok: false, code: "PROCESS_RESPONSE_INVALID" }
}

const reconciliationProjection = "status,processed_at,superseded_at,safe_error_code,lock_token,locked_at" as const
type ReconciliationKind = { ok: true; kind: "processed" | "blocked" | "superseded" } | { ok: false }
function validReconciliationTimestamp(value: unknown) { return typeof value === "string" && value.trim().length > 0 && Number.isFinite(new Date(value).getTime()) }
function parseReconciledSchedulerEventRow(row: unknown): ReconciliationKind {
  if (!isPlainObject(row) || !keysAre(row, ["status", "processed_at", "superseded_at", "safe_error_code", "lock_token", "locked_at"])) return { ok: false }
  if (row.lock_token !== null || row.locked_at !== null) return { ok: false }
  if (row.status === "processed" && validReconciliationTimestamp(row.processed_at) && row.superseded_at === null && row.safe_error_code === null) return { ok: true, kind: "processed" }
  if (row.status === "blocked" && validReconciliationTimestamp(row.processed_at) && row.superseded_at === null && typeof row.safe_error_code === "string" && safeErrors.has(row.safe_error_code)) return { ok: true, kind: "blocked" }
  if (row.status === "superseded" && row.processed_at === null && validReconciliationTimestamp(row.superseded_at) && row.safe_error_code === null) return { ok: true, kind: "superseded" }
  return { ok: false }
}
async function reconcileUncertainProcessSchedulerEvent(admin: SchedulerAdminClient, eventId: string): Promise<ReconciliationKind> {
  if (typeof admin.from !== "function") return { ok: false }
  try {
    const response = await admin.from("creator_publishing_scheduler_events").select(reconciliationProjection).eq("id", eventId).limit(1)
    if (!isPlainObject(response) || response.error) return { ok: false }
    if (!Array.isArray(response.data) || response.data.length !== 1) return { ok: false }
    return parseReconciledSchedulerEventRow(response.data[0])
  } catch {
    return { ok: false }
  }
}

export async function runCreatorPublishingSchedulerCore(input: { headers: HeaderMap; configuredSecret: string | undefined; buildEnabled: boolean; environmentEnabled: string | undefined; getAdminClient: () => SchedulerAdminClient }): Promise<SchedulerRunResult> {
  const auth = authenticateSchedulerRequest(input.headers, input.configuredSecret)
  if (auth.ok === false) return auth
  if (input.buildEnabled !== true) return { ok: false, code: "SCHEDULER_BUILD_DISABLED" }
  if (input.environmentEnabled !== "true") return { ok: false, code: "SCHEDULER_ENV_DISABLED" }
  let admin: SchedulerAdminClient
  try { admin = input.getAdminClient() } catch { return { ok: false, code: "SCHEDULER_SERVICE_UNAVAILABLE" } }
  const counts: Counts = { claimedCount: 0, attemptedCount: 0, processedCount: 0, blockedCount: 0, supersededCount: 0 }
  let claim: RpcResult
  try {
    claim = await admin.rpc("creator_publishing_claim_due_scheduler_events", { p_limit: CREATOR_PUBLISHING_SCHEDULER_CLAIM_LIMIT, p_lock_minutes: CREATOR_PUBLISHING_SCHEDULER_LOCK_MINUTES })
  } catch {
    return { ok: false, code: "CLAIM_RPC_FAILED", ...counts }
  }
  if (claim.error) return { ok: false, code: "CLAIM_RPC_FAILED", ...counts }
  const parsedClaim = parseClaimSchedulerEvents(claim.data)
  if (!parsedClaim.ok) return { ok: false, code: "CLAIM_RESPONSE_INVALID", ...counts }
  counts.claimedCount = parsedClaim.events.length
  for (const claimed of parsedClaim.events) {
    counts.attemptedCount += 1
    let processed: RpcResult
    try {
      processed = await admin.rpc("creator_publishing_process_scheduler_event", { p_event_id: claimed.event_id, p_lock_token: claimed.lock_token, p_current_ai_twin_consent_version: AI_TWIN_CONSENT_VERSION, p_current_attestation_text_sha256: getAiTwinConsentTextSha256() })
    } catch {
      const reconciled = await reconcileUncertainProcessSchedulerEvent(admin, claimed.event_id)
      if (!reconciled.ok) return { ok: false, code: "PROCESS_RPC_FAILED", ...counts }
      if (reconciled.kind === "processed") counts.processedCount += 1
      if (reconciled.kind === "blocked") counts.blockedCount += 1
      if (reconciled.kind === "superseded") counts.supersededCount += 1
      continue
    }
    if (processed.error) {
      const reconciled = await reconcileUncertainProcessSchedulerEvent(admin, claimed.event_id)
      if (!reconciled.ok) return { ok: false, code: "PROCESS_RPC_FAILED", ...counts }
      if (reconciled.kind === "processed") counts.processedCount += 1
      if (reconciled.kind === "blocked") counts.blockedCount += 1
      if (reconciled.kind === "superseded") counts.supersededCount += 1
      continue
    }
    const parsed = parseProcessSchedulerEvent(processed.data)
    if (parsed.ok === false) return { ok: false, code: parsed.code, ...counts }
    if (parsed.kind === "processed") counts.processedCount += 1
    if (parsed.kind === "blocked") counts.blockedCount += 1
    if (parsed.kind === "superseded") counts.supersededCount += 1
  }
  return { ok: true, code: "SCHEDULER_RUN_COMPLETED", ...counts }
}
