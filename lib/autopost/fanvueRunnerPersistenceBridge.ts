import {
  validateFanvueLaunchReadyContentPayload,
  type FanvueLaunchReadyContentType,
  type FanvueLaunchReadyJobPayload,
} from "./fanvueLaunchReadiness"

export const FANVUE_RUNNER_PERSISTENCE_BRIDGE_MODE = "internal_mocked_runner_persistence" as const
export const FANVUE_RUNNER_PERSISTENCE_BRIDGE_GATE = "FANVUE_INTERNAL_RUNNER_PERSISTENCE_BRIDGE_ENABLED" as const

type SafeCode =
  | "FANVUE_MOCKED_RUNNER_PERSISTENCE_SUCCESS"
  | "FANVUE_MOCKED_RUNNER_PERSISTENCE_VALIDATION_FAILED"
  | "FANVUE_MOCKED_RUNNER_PERSISTENCE_GATE_DISABLED"

export type FanvueRunnerPersistenceBridgeInput = {
  rule_id: string
  user_id: string
  scheduled_for: string
  content_payload: unknown
  selected_platforms?: unknown
  env?: Record<string, string | undefined>
  outcome?: "success" | "failure"
}

export type FanvueRunnerPersistenceBridgeResult = {
  dry_run: true
  platform: "fanvue"
  content_type: FanvueLaunchReadyContentType | null
  bridge_mode: typeof FANVUE_RUNNER_PERSISTENCE_BRIDGE_MODE
  dispatch_enabled: false
  live_attempted: false
  fanvue_upload_attempted: false
  fanvue_post_attempted: false
  provider_post_uuid_present: false
  supabase_mutation_intent: "mocked_only"
  schedule_advance_intent: "mocked_only"
  job_persistence_intent: "mocked_success" | "mocked_failure"
  schedule_state_intent: "advance_after_mocked_success" | "do_not_advance_after_mocked_failure"
  safe_code: SafeCode | string
  safe_error_message?: string
  payload: null | Pick<FanvueLaunchReadyJobPayload, "platform" | "rule_id" | "user_id" | "scheduled_for" | "content_type" | "internal_launch_readiness_only" | "dispatch_enabled" | "live_gate_required">
}

function isBridgeEnabled(env: Record<string, string | undefined> = process.env) {
  return env[FANVUE_RUNNER_PERSISTENCE_BRIDGE_GATE] === "true"
}

function baseResult(contentType: FanvueLaunchReadyContentType | null): Omit<FanvueRunnerPersistenceBridgeResult, "job_persistence_intent" | "schedule_state_intent" | "safe_code" | "payload"> {
  return {
    dry_run: true,
    platform: "fanvue",
    content_type: contentType,
    bridge_mode: FANVUE_RUNNER_PERSISTENCE_BRIDGE_MODE,
    dispatch_enabled: false,
    live_attempted: false,
    fanvue_upload_attempted: false,
    fanvue_post_attempted: false,
    provider_post_uuid_present: false,
    supabase_mutation_intent: "mocked_only",
    schedule_advance_intent: "mocked_only",
  }
}

export function buildFanvueMockedRunnerPersistenceBridge(
  input: FanvueRunnerPersistenceBridgeInput,
): FanvueRunnerPersistenceBridgeResult {
  if (!isBridgeEnabled(input.env)) {
    return {
      ...baseResult(null),
      job_persistence_intent: "mocked_failure",
      schedule_state_intent: "do_not_advance_after_mocked_failure",
      safe_code: "FANVUE_MOCKED_RUNNER_PERSISTENCE_GATE_DISABLED",
      safe_error_message: "Fanvue mocked runner persistence bridge is disabled.",
      payload: null,
    }
  }

  const validation = validateFanvueLaunchReadyContentPayload(input)
  if (validation.valid === false) {
    return {
      ...baseResult(null),
      job_persistence_intent: "mocked_failure",
      schedule_state_intent: "do_not_advance_after_mocked_failure",
      safe_code: validation.error_code || "FANVUE_MOCKED_RUNNER_PERSISTENCE_VALIDATION_FAILED",
      safe_error_message: "Fanvue mocked runner persistence validation failed safely.",
      payload: null,
    }
  }

  const shouldFail = input.outcome === "failure"
  return {
    ...baseResult(validation.payload.content_type),
    job_persistence_intent: shouldFail ? "mocked_failure" : "mocked_success",
    schedule_state_intent: shouldFail ? "do_not_advance_after_mocked_failure" : "advance_after_mocked_success",
    safe_code: shouldFail ? "FANVUE_MOCKED_RUNNER_PERSISTENCE_VALIDATION_FAILED" : "FANVUE_MOCKED_RUNNER_PERSISTENCE_SUCCESS",
    safe_error_message: shouldFail ? "Fanvue mocked runner persistence failed safely." : undefined,
    payload: {
      platform: validation.payload.platform,
      rule_id: validation.payload.rule_id,
      user_id: validation.payload.user_id,
      scheduled_for: validation.payload.scheduled_for,
      content_type: validation.payload.content_type,
      internal_launch_readiness_only: validation.payload.internal_launch_readiness_only,
      dispatch_enabled: validation.payload.dispatch_enabled,
      live_gate_required: validation.payload.live_gate_required,
    },
  }
}
