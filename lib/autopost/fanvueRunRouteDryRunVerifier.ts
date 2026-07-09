import { FANVUE_RUN_DRY_RUN_CONFIRMATION, runFanvueDryRunBranch, type FanvueRunDryRunBranchResult, type FanvueRunDryRunBranchRule } from './fanvueRunDryRunBranch'

export type FanvueRouteDryRunSummary = {
  fanvue_dry_runs: number
  fanvue_dry_run_blocked: number
}

export function runFanvueRouteDryRunVerification(args: {
  rules: FanvueRunDryRunBranchRule[]
  now: Date
  env?: Record<string, string | undefined>
  request_confirmation?: unknown
  summary: FanvueRouteDryRunSummary
}): FanvueRunDryRunBranchResult[] {
  const results: FanvueRunDryRunBranchResult[] = []

  for (const rule of args.rules) {
    if (!Array.isArray(rule.selected_platforms) || !rule.selected_platforms.includes('fanvue')) continue

    const fanvueDryRun = runFanvueDryRunBranch({
      rule,
      now: args.now,
      env: args.env,
      request_confirmation: args.request_confirmation,
    })

    if (fanvueDryRun.safe_code === 'FANVUE_MOCKED_RUNNER_PERSISTENCE_SUCCESS') {
      args.summary.fanvue_dry_runs++
    } else {
      args.summary.fanvue_dry_run_blocked++
    }

    results.push(fanvueDryRun)
  }

  return results
}

export function isFanvueRouteDryRunConfirmed(confirmation: unknown) {
  return confirmation === FANVUE_RUN_DRY_RUN_CONFIRMATION
}
