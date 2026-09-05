import { NextResponse } from "next/server"
import { requireFreshTotpResponse } from "@/lib/security/mfaRoute"
import {
  listLegalHolds,
  openLegalHold,
  validateIdempotencyKey,
  validateOpenLegalHoldInput,
} from "@/lib/governance/legalHolds"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const headers = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", "X-Content-Type-Options": "nosniff" }
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers })

export async function GET(request: Request) {
  const mfa = await requireFreshTotpResponse()
  if (mfa instanceof NextResponse) return mfa
  if (!mfa.freshTotpAt) return json({ ok: false, code: "MFA_FRESH_AUTH_REQUIRED" }, 428)

  const url = new URL(request.url)
  for (const key of url.searchParams.keys()) {
    if (key !== "status" && key !== "limit") return json({ ok: false, code: "LEGAL_HOLD_PARAMETERS_INVALID" }, 400)
  }
  const rawStatus = url.searchParams.get("status")
  const status = rawStatus === null || rawStatus === "" ? null : rawStatus
  if (status !== null && status !== "active" && status !== "released" && status !== "expired") {
    return json({ ok: false, code: "LEGAL_HOLD_PARAMETERS_INVALID" }, 400)
  }
  const rawLimit = url.searchParams.get("limit")
  const limit = rawLimit === null ? 50 : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return json({ ok: false, code: "LEGAL_HOLD_PARAMETERS_INVALID" }, 400)

  const result = await listLegalHolds({ actorUserId: mfa.userId, freshTotpAt: mfa.freshTotpAt, status, limit })
  if (!result.ok) {
    const denied = result.code === "GOVERNANCE_LEGAL_HOLD_ADMIN_REQUIRED" || result.code === "GOVERNANCE_LEGAL_HOLD_FRESH_AUTH_REQUIRED"
    return json(result, denied ? 403 : 503)
  }
  return json({ ok: true, register: result.data })
}

export async function POST(request: Request) {
  const mfa = await requireFreshTotpResponse()
  if (mfa instanceof NextResponse) return mfa
  if (!mfa.freshTotpAt) return json({ ok: false, code: "MFA_FRESH_AUTH_REQUIRED" }, 428)

  const idempotencyKey = request.headers.get("idempotency-key")
  if (!validateIdempotencyKey(idempotencyKey)) return json({ ok: false, code: "LEGAL_HOLD_IDEMPOTENCY_KEY_INVALID" }, 400)

  let body: unknown
  try { body = await request.json() } catch { return json({ ok: false, code: "LEGAL_HOLD_REQUEST_INVALID" }, 400) }
  const input = validateOpenLegalHoldInput(body)
  if (!input) return json({ ok: false, code: "LEGAL_HOLD_REQUEST_INVALID" }, 400)

  const result = await openLegalHold({ actorUserId: mfa.userId, freshTotpAt: mfa.freshTotpAt, idempotencyKey, input })
  if (!result.ok) {
    const denied = result.code === "GOVERNANCE_LEGAL_HOLD_ADMIN_REQUIRED" || result.code === "GOVERNANCE_LEGAL_HOLD_FRESH_AUTH_REQUIRED"
    const conflict = result.code === "GOVERNANCE_LEGAL_HOLD_IDEMPOTENCY_CONFLICT"
    return json(result, denied ? 403 : conflict ? 409 : 503)
  }
  return json(result, 201)
}
