import { NextResponse } from "next/server"
import { requireXAdminUserId } from "@/lib/autopost/xAdminAuthorization"
import { requireFreshTotpResponse } from "@/lib/security/mfaRoute"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import {
  buildXAuthorizeUrl,
  createXReauthorizationOAuthState,
  setXOAuthCookie,
} from "@/lib/autopost/xOAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const CONFIRMATION = "preserve-existing-x-identity-v1"
const MAX_ZERO_LENGTH_READS = 8
const BODY_READ_TIMEOUT_MS = 250
const BODY_CANCEL_TIMEOUT_MS = 50
const SECURITY_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  expires: "0",
  "x-content-type-options": "nosniff",
}

type SafeCode =
  | "X_REAUTH_START_UNAUTHENTICATED"
  | "X_REAUTH_START_CONFIRMATION_REQUIRED"
  | "X_REAUTH_START_PARAMETERS_NOT_ALLOWED"
  | "X_REAUTH_START_METHOD_NOT_ALLOWED"
  | "X_REAUTH_START_ACCOUNT_LOOKUP_FAILED"
  | "X_REAUTH_START_ACCOUNT_NOT_READY"
  | "X_REAUTH_START_STATE_FAILED"
  | "X_REAUTH_START_READY"

function response(safeCode: SafeCode, status: number, authorizationUrl?: string) {
  return NextResponse.json(
    {
      ok: safeCode === "X_REAUTH_START_READY",
      mode: "x_controlled_reauthorization_start",
      safe_code: safeCode,
      ...(authorizationUrl ? { authorization_url: authorizationUrl } : {}),
      read_only: true,
      provider_request_attempted: false,
      database_write_attempted: false,
      oauth_token_exchange_attempted: false,
      refresh_attempted: false,
      retry_attempted: false,
      reconnect_completed: false,
      disconnect_attempted: false,
      post_attempted: false,
      fanvue_account_queried: false,
      fanvue_account_mutated: false,
    },
    { status, headers: SECURITY_HEADERS }
  )
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("request body operation timed out")), timeoutMs)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const cancellation = reader.cancel().catch(() => undefined)
  try {
    await Promise.race([
      cancellation,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, BODY_CANCEL_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

async function hasRequestBody(req: Request) {
  if (req.body === null) return false

  const reader = req.body.getReader()
  try {
    for (let zeroLengthReads = 0; zeroLengthReads <= MAX_ZERO_LENGTH_READS; zeroLengthReads++) {
      const { done, value } = await withTimeout(reader.read(), BODY_READ_TIMEOUT_MS)
      if (done) return false
      if (value.byteLength > 0) {
        await cancelReader(reader)
        return true
      }
    }
    await cancelReader(reader)
    throw new Error("request body produced too many zero-length chunks")
  } catch (error) {
    await cancelReader(reader)
    throw error
  } finally {
    try {
      reader.releaseLock()
    } catch {
      throw new Error("request body reader cleanup failed")
    }
  }
}

export async function POST(req: Request) {
  const mfa = await requireFreshTotpResponse()
  if (mfa instanceof NextResponse) return mfa
  const userId = await requireXAdminUserId({ request: req }).catch(() => null)
  if (!userId?.trim()) return response("X_REAUTH_START_UNAUTHENTICATED", 401)
  if (req.headers.get("x-autopost-x-reauthorize") !== CONFIRMATION) {
    return response("X_REAUTH_START_CONFIRMATION_REQUIRED", 400)
  }
  const url = new URL(req.url)
  if (url.search.length) {
    return response("X_REAUTH_START_PARAMETERS_NOT_ALLOWED", 400)
  }
  try {
    if (await hasRequestBody(req)) {
      return response("X_REAUTH_START_PARAMETERS_NOT_ALLOWED", 400)
    }
  } catch {
    return response("X_REAUTH_START_PARAMETERS_NOT_ALLOWED", 400)
  }

  let account: {
    connection_status?: unknown
    provider_account_id?: unknown
    provider_username?: unknown
  } | null = null
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("autopost_accounts")
      .select("connection_status, provider_account_id, provider_username")
      .eq("user_id", userId.trim())
      .eq("platform", "x")
      .maybeSingle()
    if (error) return response("X_REAUTH_START_ACCOUNT_LOOKUP_FAILED", 500)
    account = data
  } catch {
    return response("X_REAUTH_START_ACCOUNT_LOOKUP_FAILED", 500)
  }

  const providerAccountId =
    typeof account?.provider_account_id === "string" ? account.provider_account_id.trim() : ""
  const providerUsername =
    typeof account?.provider_username === "string" ? account.provider_username.trim() : ""
  if (account?.connection_status !== "CONNECTED" || !providerAccountId || !providerUsername) {
    return response("X_REAUTH_START_ACCOUNT_NOT_READY", 409)
  }

  try {
    const oauthState = createXReauthorizationOAuthState(
      userId.trim(),
      providerAccountId,
      providerUsername
    )
    const authorizationUrl = buildXAuthorizeUrl({
      state: oauthState.state,
      codeChallenge: oauthState.codeChallenge,
    }).toString()
    const result = response("X_REAUTH_START_READY", 200, authorizationUrl)
    setXOAuthCookie(result, oauthState.cookieValue)
    return result
  } catch {
    return response("X_REAUTH_START_STATE_FAILED", 500)
  }
}

export async function GET() {
  return response("X_REAUTH_START_METHOD_NOT_ALLOWED", 405)
}
