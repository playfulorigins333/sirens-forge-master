import { executePreparedFanvuePublication, type PreparedFanvueExecutionEnvelope } from "./executor"
import { classifyFanvuePublicationCapability } from "./capability"
import { fanvueProviderBaseResult, type FanvueProviderPostResult } from "../../autopost/fanvueProviderExecutorCore"

export const FANVUE_CPQ_MAX_ATTEMPTS = 3
export const FANVUE_CPQ_RETRY_BASE_SECONDS = 60
export const FANVUE_CPQ_MAX_BATCH_SIZE = 10
export type FanvueOutcomeClass = "success" | "retryable_pre_create" | "permanent" | "reconnect_required" | "uncertain"
export type ClaimedFanvueJob = { jobId: string; attemptId: string; leaseToken: string; attemptOrdinal: number }
export type PreparedFanvueClaim = { ok: true; envelope: PreparedFanvueExecutionEnvelope } | { ok: false; outcome: Exclude<FanvueOutcomeClass,"success"|"uncertain">; safeCode: string }
export type FanvueWorkerStore = {
  claimDue(limit: number, leaseMinutes: number): Promise<ClaimedFanvueJob[]>
  prepareClaim(claim: ClaimedFanvueJob): Promise<PreparedFanvueClaim>
  markCreateDispatched(attemptId: string, leaseToken: string): Promise<boolean>
  finish(input: { jobId: string; attemptId: string; leaseToken: string; attemptOrdinal: number; outcome: FanvueOutcomeClass; result: FanvueProviderPostResult; nextAttemptAt: string | null }): Promise<boolean>
}
export type FanvueWorkerSummary = { claimed: number; succeeded: number; retryScheduled: number; failed: number; reconnectRequired: number; uncertain: number }

const reconnectCodes = new Set(["FANVUE_REFRESH_TOKEN_MISSING", "FANVUE_REFRESH_UNAUTHORIZED", "FANVUE_REFRESH_INVALID_GRANT_REAUTH_REQUIRED"])
const retryablePreCreateCodes = new Set(["FANVUE_REFRESH_FAILED", "FANVUE_EXECUTION_CREATOR_IDENTITY_NETWORK_FAILED", "FANVUE_MEDIA_READY_TIMEOUT", "FANVUE_EXECUTION_MEDIA_NOT_READY", "FANVUE_EXECUTION_CREATE_DISPATCH_MARKER_FAILED"])
export function classifyFanvueExecutionOutcome(result: FanvueProviderPostResult): FanvueOutcomeClass {
  if (result.ok && result.provider_post_uuid_present) return "success"
  if (result.create_attempted && !result.provider_post_uuid_present) return "uncertain"
  if (reconnectCodes.has(result.safe_code)) return "reconnect_required"
  if (!result.create_attempted && (retryablePreCreateCodes.has(result.safe_code) || result.upload_session_status_class === "5xx" || result.signed_url_status_class === "5xx" || result.byte_upload_status_class === "5xx" || result.finalize_status_class === "5xx" || result.readiness_status_class === "timeout")) return "retryable_pre_create"
  return "permanent"
}
export function nextFanvueAttemptAt(attemptOrdinal: number, now = new Date()): string | null {
  if (attemptOrdinal >= FANVUE_CPQ_MAX_ATTEMPTS) return null
  return new Date(now.getTime() + FANVUE_CPQ_RETRY_BASE_SECONDS * 2 ** (attemptOrdinal - 1) * 1000).toISOString()
}

export async function runFanvuePublicationWorker(input: { enabled: boolean; batchSize: number; store: FanvueWorkerStore; now?: () => Date }): Promise<FanvueWorkerSummary> {
  const summary: FanvueWorkerSummary = { claimed: 0, succeeded: 0, retryScheduled: 0, failed: 0, reconnectRequired: 0, uncertain: 0 }
  if (!input.enabled) return summary
  const limit = Math.max(1, Math.min(FANVUE_CPQ_MAX_BATCH_SIZE, Math.floor(input.batchSize)))
  const jobs = await input.store.claimDue(limit, 15); summary.claimed = jobs.length
  for (const job of jobs) {
    let prepared: PreparedFanvueClaim
    try { prepared = await input.store.prepareClaim(job) } catch { prepared = { ok: false, outcome: "retryable_pre_create", safeCode: "FANVUE_CPQ_PREPARATION_TRANSIENT" } }
    let result: FanvueProviderPostResult
    let outcome: FanvueOutcomeClass
    if (prepared.ok === false) { outcome = prepared.outcome; result = fanvueProviderBaseResult({ safe_code: prepared.safeCode }) }
    else {
      const envelope = prepared.envelope
      const capability = classifyFanvuePublicationCapability(envelope.oauthAccount, envelope.creatorId)
      const contentReady = envelope.approvedContent.content_type === "text" ? capability.textReady : capability.mediaReady
      if (!contentReady) { outcome = "permanent"; result = fanvueProviderBaseResult({ safe_code: (envelope.approvedContent.content_type === "text" ? capability.missingText[0] : capability.missingMedia[0])! }) }
      else { result = await executePreparedFanvuePublication({ ...envelope, provider: { ...envelope.provider, beforeProviderCreate: () => input.store.markCreateDispatched(job.attemptId, job.leaseToken) } }); outcome = classifyFanvueExecutionOutcome(result) }
    }
    let nextAttemptAt = outcome === "retryable_pre_create" ? nextFanvueAttemptAt(job.attemptOrdinal, input.now?.() ?? new Date()) : null
    if (outcome === "retryable_pre_create" && !nextAttemptAt) outcome = "permanent"
    await input.store.finish({ jobId: job.jobId, attemptId: job.attemptId, leaseToken: job.leaseToken, attemptOrdinal: job.attemptOrdinal, outcome, result, nextAttemptAt })
    if (outcome === "success") summary.succeeded++
    else if (outcome === "retryable_pre_create") summary.retryScheduled++
    else if (outcome === "reconnect_required") summary.reconnectRequired++
    else if (outcome === "uncertain") summary.uncertain++
    else summary.failed++
  }
  return summary
}
