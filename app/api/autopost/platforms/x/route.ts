import crypto from "crypto"
import { NextResponse } from "next/server"
import { postXTextOnlyAutopost } from "@/lib/autopost/xAdapter"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function json(status: number, body: any) {
  return NextResponse.json(body, { status })
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)
  if (aBuffer.length !== bBuffer.length) return false
  return crypto.timingSafeEqual(aBuffer, bBuffer)
}

function verifyInternalAdapterSecret(req: Request) {
  const expectedSecret = process.env.AUTOPOST_INTERNAL_ADAPTER_SECRET
  if (!expectedSecret) {
    return { ok: false as const, status: 500, error_code: "AUTOPOST_INTERNAL_ADAPTER_SECRET_NOT_CONFIGURED" }
  }

  const providedSecret = req.headers.get("x-autopost-internal-secret") ?? ""
  if (!providedSecret) {
    return { ok: false as const, status: 401, error_code: "INTERNAL_ADAPTER_SECRET_REQUIRED" }
  }

  if (!safeEqual(providedSecret, expectedSecret)) {
    return { ok: false as const, status: 403, error_code: "INTERNAL_ADAPTER_SECRET_INVALID" }
  }

  return { ok: true as const }
}

export async function POST(req: Request) {
  const auth = verifyInternalAdapterSecret(req)
  if (!auth.ok) {
    return json(auth.status, {
      ok: false,
      status: "FAILED",
      platform: "x",
      error_code: auth.error_code,
    })
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return json(400, {
      ok: false,
      status: "FAILED",
      platform: "x",
      error_code: "INVALID_JSON",
      error_message: "Request body must be valid JSON",
    })
  }

  const result = await postXTextOnlyAutopost(payload ?? {})
  const statusCode = result.ok
    ? 200
    : result.status === "NOT_CONFIGURED"
      ? 409
      : result.status === "UNSUPPORTED"
        ? 422
        : 400

  return json(statusCode, result)
}

export async function GET() {
  return json(405, {
    ok: false,
    status: "FAILED",
    platform: "x",
    error_code: "METHOD_NOT_ALLOWED",
    error_message: "POST only",
  })
}
