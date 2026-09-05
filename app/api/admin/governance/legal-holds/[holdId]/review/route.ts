import { NextResponse } from "next/server"
import { requireFreshTotpResponse } from "@/lib/security/mfaRoute"
import { reviewLegalHold, validateIdempotencyKey, validateReviewLegalHoldInput } from "@/lib/governance/legalHolds"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const headers = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", "X-Content-Type-Options": "nosniff" }
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers })
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: Request, context: { params: Promise<{ holdId: string }> }) {
  const mfa = await requireFreshTotpResponse()
  if (mfa instanceof NextResponse) return mfa
  if (!mfa.freshTotpAt) return json({ ok: false, code: "MFA_FRESH_AUTH_REQUIRED" }, 428)

  const { holdId } = await context.params
  if (!uuidPattern.test(holdId)) return json({ ok: false, code: "LEGAL_HOLD_ID_INVALID" }, 400)
  const idempotencyKey = request.headers.get("idempotency-key")
  if (!validateIdempotencyKey(idempotencyKey)) return json({ ok: false, code: "LEGAL_HOLD_IDEMPOTENCY_KEY_INVALID" }, 400)

  let body: unknown
  try { body = await request.json() } catch { return json({ ok: false, code: "LEGAL_HOLD_REQUEST_INVALID" }, 400) }
  const input = validateReviewLegalHoldInput(body)
  if (!input) return json({ ok: false, code: "LEGAL_HOLD_REQUEST_INVALID" }, 400)

  const result = await reviewLegalHold({ holdId, actorUserId: mfa.userId, freshTotpAt: mfa.freshTotpAt, idempotencyKey, input })
  if (!result.ok) {
    const denied = result.code === "GOVERNANCE_LEGAL_HOLD_ADMIN_REQUIRED" || result.code === "GOVERNANCE_LEGAL_HOLD_FRESH_AUTH_REQUIRED"
    const conflict = result.code === "GOVERNANCE_LEGAL_HOLD_IDEMPOTENCY_CONFLICT" || result.code === "GOVERNANCE_LEGAL_HOLD_REVIEW_CANNOT_SHORTEN"
    const missing = result.code === "GOVERNANCE_LEGAL_HOLD_NOT_FOUND"
    return json(result, denied ? 403 : missing ? 404 : conflict ? 409 : 503)
  }
  return json(result)
}
