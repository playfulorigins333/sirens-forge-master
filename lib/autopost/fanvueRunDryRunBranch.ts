import { buildFanvueMockedRunnerPersistenceBridge, type FanvueRunnerPersistenceBridgeResult } from "./fanvueRunnerPersistenceBridge"

export const FANVUE_RUN_DRY_RUN_BRANCH_GATE = "FANVUE_RUN_DRY_RUN_BRANCH_ENABLED" as const

export type FanvueRunDryRunBranchRule = {
  id: string
  user_id: string
  approval_state?: string | null
  enabled?: boolean | null
  paused_at?: string | null
  revoked_at?: string | null
  next_run_at?: string | null
  selected_platforms?: unknown
  content_payload?: unknown
}

type FanvueRunDryRunBranchSafeCode =
  | "FANVUE_RUN_DRY_RUN_BRANCH_GATE_DISABLED"
  | "FANVUE_RUN_DRY_RUN_BRANCH_NOT_ELIGIBLE"
  | "FANVUE_RUN_DRY_RUN_BRANCH_NOT_DUE"
  | "FANVUE_RUN_DRY_RUN_BRANCH_PLATFORM_NOT_SELECTED"

export type FanvueRunDryRunBranchResult = FanvueRunnerPersistenceBridgeResult | {
  dry_run: true
  platform: "fanvue"
  bridge_mode: "internal_mocked_runner_persistence"
  dispatch_enabled: false
  live_attempted: false
  fanvue_upload_attempted: false
  fanvue_post_attempted: false
  provider_post_uuid_present: false
  supabase_mutation_intent: "dependency_injected_only"
  schedule_advance_intent: "mocked_only"
  safe_code: FanvueRunDryRunBranchSafeCode
  safe_error_message: string
  payload: null
}

function disabledResult(safeCode: FanvueRunDryRunBranchSafeCode, message: string): FanvueRunDryRunBranchResult {
  return {
    dry_run: true,
    platform: "fanvue",
    bridge_mode: "internal_mocked_runner_persistence",
    dispatch_enabled: false,
    live_attempted: false,
    fanvue_upload_attempted: false,
    fanvue_post_attempted: false,
    provider_post_uuid_present: false,
    supabase_mutation_intent: "dependency_injected_only",
    schedule_advance_intent: "mocked_only",
    safe_code: safeCode,
    safe_error_message: message,
    payload: null,
  }
}

export function isFanvueRunDryRunBranchEnabled(env: Record<string, string | undefined> = process.env) {
  return env[FANVUE_RUN_DRY_RUN_BRANCH_GATE] === "true"
}

export function runFanvueDryRunBranch(args: {
  rule: FanvueRunDryRunBranchRule
  now: Date
  env?: Record<string, string | undefined>
}): FanvueRunDryRunBranchResult {
  const env = args.env ?? process.env
  const rule = args.rule

  if (!isFanvueRunDryRunBranchEnabled(env)) {
    return disabledResult("FANVUE_RUN_DRY_RUN_BRANCH_GATE_DISABLED", "Fanvue run dry-run branch is disabled.")
  }

  if (rule.approval_state !== "APPROVED" || rule.enabled !== true || rule.paused_at || rule.revoked_at || !rule.next_run_at) {
    return disabledResult("FANVUE_RUN_DRY_RUN_BRANCH_NOT_ELIGIBLE", "Fanvue rule is not eligible for run dry-run dispatch.")
  }

  const nextRunAt = new Date(rule.next_run_at)
  if (Number.isNaN(nextRunAt.getTime()) || nextRunAt.getTime() > args.now.getTime()) {
    return disabledResult("FANVUE_RUN_DRY_RUN_BRANCH_NOT_DUE", "Fanvue rule is not due for run dry-run dispatch.")
  }

  if (!Array.isArray(rule.selected_platforms) || !rule.selected_platforms.includes("fanvue")) {
    return disabledResult("FANVUE_RUN_DRY_RUN_BRANCH_PLATFORM_NOT_SELECTED", "Fanvue is not selected for this rule.")
  }

  return buildFanvueMockedRunnerPersistenceBridge({
    rule_id: rule.id,
    user_id: rule.user_id,
    scheduled_for: rule.next_run_at,
    selected_platforms: rule.selected_platforms,
    content_payload: rule.content_payload,
    env,
  })
}
