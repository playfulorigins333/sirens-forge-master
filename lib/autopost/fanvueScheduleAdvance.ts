import type { FanvueLivePostProof } from "./fanvueProof"

export type FanvueScheduleAdvanceInput = {
  platform?: unknown
  result_status?: unknown
  platform_post_id?: unknown
  posted_at?: unknown
  job_id?: unknown
  rule_id?: unknown
  user_id?: unknown
  scheduled_for?: unknown
  adapter_result_kind?: unknown
  ok?: unknown
  workflow_task_id?: unknown
  external_job_id?: unknown
  validated_proof?: (FanvueLivePostProof & {
    job_id?: string | null
    rule_id?: string | null
    user_id?: string | null
    scheduled_for?: string | null
  }) | null
}

export type FanvueScheduleAdvanceDecision = {
  can_advance: boolean
  blocker: string | null
  proof_required: boolean
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function blocked(blocker: string): FanvueScheduleAdvanceDecision {
  return { can_advance: false, blocker, proof_required: true }
}

export function validateFanvueScheduleAdvanceProof(input: FanvueScheduleAdvanceInput): FanvueScheduleAdvanceDecision {
  if (input.platform !== "fanvue") return blocked("FANVUE_ADVANCE_PLATFORM_INVALID")
  if (input.workflow_task_id) return blocked("FANVUE_ASSISTED_WORKFLOW_NOT_PROOF")
  if (input.external_job_id) return blocked("FANVUE_EXTERNAL_JOB_NOT_PROOF")
  if (input.ok === true && !input.validated_proof) return blocked("FANVUE_OK_TRUE_NOT_PROOF")
  if (input.adapter_result_kind === "SCHEDULED_CREATED") return blocked("FANVUE_SCHEDULED_CREATED_NOT_LIVE_PROOF")
  if (input.adapter_result_kind === "POSTED_READY_FOR_PROOF" && !input.validated_proof) {
    return blocked("FANVUE_POSTED_READY_FOR_PROOF_NOT_PERSISTED_PROOF")
  }

  if (input.result_status !== "POSTED") return blocked("FANVUE_ADVANCE_REQUIRES_POSTED_STATUS")
  if (!nonEmptyString(input.platform_post_id)) return blocked("FANVUE_ADVANCE_PLATFORM_POST_ID_MISSING")
  if (!nonEmptyString(input.posted_at)) return blocked("FANVUE_ADVANCE_POSTED_AT_MISSING")

  const proof = input.validated_proof
  if (!proof?.posted || proof.platform !== "fanvue") return blocked("FANVUE_VALIDATED_LIVE_PROOF_REQUIRED")
  if (proof.platform_post_id !== input.platform_post_id) return blocked("FANVUE_ADVANCE_POST_ID_MISMATCH")
  if (proof.posted_at !== input.posted_at) return blocked("FANVUE_ADVANCE_POSTED_AT_MISMATCH")

  if (!nonEmptyString(input.job_id) || proof.job_id !== input.job_id) return blocked("FANVUE_ADVANCE_JOB_CORRELATION_MISSING")
  if (!nonEmptyString(input.rule_id) || proof.rule_id !== input.rule_id) return blocked("FANVUE_ADVANCE_RULE_CORRELATION_MISSING")
  if (!nonEmptyString(input.user_id) || proof.user_id !== input.user_id) return blocked("FANVUE_ADVANCE_USER_CORRELATION_MISSING")
  if (!nonEmptyString(input.scheduled_for) || proof.scheduled_for !== input.scheduled_for) {
    return blocked("FANVUE_ADVANCE_SCHEDULE_CORRELATION_MISSING")
  }

  return { can_advance: true, blocker: null, proof_required: false }
}
