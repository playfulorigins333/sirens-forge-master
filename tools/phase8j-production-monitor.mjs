const DEFAULT_ORIGIN = "https://sirensforge.vip"
const TIMEOUT_MS = 10_000
const HEALTHY_TIER_STATES = new Set(["available", "sold_out"])

function finiteFailure(check, code, status = null) {
  return { ok: false, check, code, ...(Number.isInteger(status) ? { status } : {}) }
}

async function getJson(fetchImpl, url) {
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) return { ok: false, status: response.status }
    const json = await response.json().catch(() => null)
    if (!json || typeof json !== "object") return { ok: false, status: response.status }
    return { ok: true, status: response.status, json }
  } catch {
    return { ok: false }
  }
}

export async function checkApplicationHealth(fetchImpl, origin) {
  const result = await getJson(fetchImpl, `${origin}/api/health`)
  if (!result.ok) return finiteFailure("application_health", "HEALTH_REQUEST_FAILED", result.status)
  if (result.json.status !== "ok") return finiteFailure("application_health", "HEALTH_RESPONSE_INVALID", result.status)
  return { ok: true, check: "application_health" }
}

export async function checkPaymentReadiness(fetchImpl, origin) {
  const result = await getJson(fetchImpl, `${origin}/api/payment-v2/readiness`)
  if (!result.ok) return finiteFailure("payment_v2_readiness", "PAYMENT_READINESS_REQUEST_FAILED", result.status)
  const tiers = result.json.tiers
  if (
    result.json.checkoutMode !== "payment_v2" ||
    !tiers ||
    !HEALTHY_TIER_STATES.has(tiers.og_throne) ||
    !HEALTHY_TIER_STATES.has(tiers.early_bird)
  ) {
    return finiteFailure("payment_v2_readiness", "PAYMENT_READINESS_UNHEALTHY", result.status)
  }
  return { ok: true, check: "payment_v2_readiness" }
}

export async function runProductionMonitor({ fetchImpl = fetch, origin = process.env.SIRENS_MONITOR_ORIGIN || DEFAULT_ORIGIN } = {}) {
  const normalizedOrigin = origin.replace(/\/$/, "")
  const results = await Promise.all([
    checkApplicationHealth(fetchImpl, normalizedOrigin),
    checkPaymentReadiness(fetchImpl, normalizedOrigin),
  ])
  return { ok: results.every((result) => result.ok), results }
}

async function main() {
  const outcome = await runProductionMonitor()
  if (!outcome.ok) {
    for (const result of outcome.results.filter((entry) => !entry.ok)) {
      console.error(JSON.stringify({ event: "production_monitor_failed", ...result }))
    }
    process.exitCode = 1
    return
  }
  console.log(JSON.stringify({ event: "production_monitor_ok", checks: outcome.results.map((entry) => entry.check) }))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
