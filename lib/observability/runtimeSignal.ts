type RuntimeFailureSignal = {
  event: "launch_critical_failure"
  route: string
  code: string
  status: number
}

/**
 * Emit only finite, non-sensitive launch telemetry. Never pass request bodies,
 * auth/session material, provider payloads, user IDs, emails, or raw errors.
 */
export function emitLaunchCriticalFailure(input: Omit<RuntimeFailureSignal, "event">) {
  const signal: RuntimeFailureSignal = {
    event: "launch_critical_failure",
    route: input.route,
    code: input.code,
    status: input.status,
  }
  console.error(JSON.stringify(signal))
}
