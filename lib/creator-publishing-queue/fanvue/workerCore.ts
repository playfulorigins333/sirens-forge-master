import { executePreparedFanvuePublication, type PreparedFanvueExecutionEnvelope } from "./executor"
import { classifyFanvuePublicationCapability } from "./capability"
import type { FanvueProviderPostResult } from "../../autopost/fanvueProviderExecutorCore"

export const FANVUE_CPQ_MAX_ATTEMPTS = 3
export const FANVUE_CPQ_RETRY_BASE_SECONDS = 60
export const FANVUE_CPQ_MAX_BATCH_SIZE = 10
export type FanvueOutcomeClass = "success" | "retryable_pre_create" | "permanent" | "reconnect_required" | "uncertain"
export type ClaimedFanvueJob = { jobId: string; attemptId: string; leaseToken: string; attemptOrdinal: number; envelope: PreparedFanvueExecutionEnvelope }
export type FanvueWorkerStore = {
  claimDue(limit: number, leaseMinutes: number): Promise<ClaimedFanvueJob[]>
  entitlementActive(creatorId: string): Promise<boolean>
  executionRequirementsValid(jobId: string, creatorId: string): Promise<boolean>
  markCreateDispatched(attemptId: string, leaseToken: string): Promise<boolean>
  finish(input: { jobId: string; attemptId: string; leaseToken: string; attemptOrdinal: number; outcome: FanvueOutcomeClass; result: FanvueProviderPostResult; nextAttemptAt: string | null }): Promise<boolean>
}
export type FanvueWorkerSummary = { claimed: number; succeeded: number; retryScheduled: number; failed: number; reconnectRequired: number; uncertain: number }

const reconnectCodes = new Set(["FANVUE_REFRESH_TOKEN_MISSING", "FANVUE_REFRESH_UNAUTHORIZED", "FANVUE_REFRESH_INVALID_GRANT_REAUTH_REQUIRED"])
const retryablePreCreateCodes = new Set(["FANVUE_REFRESH_FAILED", "FANVUE_EXECUTION_CREATOR_IDENTITY_NETWORK_FAILED", "FANVUE_MEDIA_READY_TIMEOUT", "FANVUE_EXECUTION_MEDIA_NOT_READY"])
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
    let result: FanvueProviderPostResult
    const capability = classifyFanvuePublicationCapability(job.envelope.oauthAccount, job.envelope.creatorId)
    const contentReady = job.envelope.approvedContent.content_type === "text" ? capability.textReady : capability.mediaReady
    const permitted = await input.store.entitlementActive(job.envelope.creatorId) && await input.store.executionRequirementsValid(job.jobId, job.envelope.creatorId)
    if (!permitted || !contentReady) {
      result = { ...(await executePreparedFanvuePublication({ ...job.envelope, oauthAccount: { ...job.envelope.oauthAccount, connection_status: "BLOCKED" } })), live_attempted: false, safe_code: permitted ? (job.envelope.approvedContent.content_type === "text" ? capability.missingText[0] : capability.missingMedia[0])! : "FANVUE_CPQ_REQUIREMENTS_INVALID" }
    } else result = await executePreparedFanvuePublication({ ...job.envelope, provider: { ...job.envelope.provider, beforeProviderCreate: () => input.store.markCreateDispatched(job.attemptId, job.leaseToken) } })
    let outcome = classifyFanvueExecutionOutcome(result)
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
