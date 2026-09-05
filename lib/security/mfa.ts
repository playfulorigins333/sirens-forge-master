import { supabaseServer } from "@/lib/supabaseServer"

export const FRESH_TOTP_MAX_AGE_SECONDS = 10 * 60
export const MFA_CLOCK_SKEW_SECONDS = 5

export type MfaError = "UNAUTHENTICATED" | "MFA_ENROLLMENT_REQUIRED" | "MFA_CHALLENGE_REQUIRED" | "MFA_FRESH_AUTH_REQUIRED" | "MFA_LOOKUP_FAILED"
export type MfaResult =
  | { ok: true; userId: string; freshTotpAt?: string }
  | { ok: false; error: MfaError; status: 401 | 428 | 503; actionPath?: string }

type MfaClient = Awaited<ReturnType<typeof supabaseServer>>

export async function getCurrentMfaPosture(client?: MfaClient) {
  const supabase = client ?? await supabaseServer()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { ok: false as const, error: "UNAUTHENTICATED" as const }
  const [factors, assurance] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ])
  if (factors.error || assurance.error || !assurance.data) return { ok: false as const, error: "MFA_LOOKUP_FAILED" as const }
  const verifiedTotp = factors.data.totp.filter((factor) => factor.status === "verified")
  return { ok: true as const, userId: userData.user.id, verifiedTotp, ...assurance.data }
}

export async function requireOptInMfaSatisfied(client?: MfaClient): Promise<MfaResult> {
  const posture = await getCurrentMfaPosture(client)
  if (!posture.ok) return posture.error === "UNAUTHENTICATED"
    ? { ok: false, error: posture.error, status: 401 }
    : { ok: false, error: posture.error, status: 503 }
  if (posture.verifiedTotp.length > 0 && posture.currentLevel !== "aal2") {
    return { ok: false, error: "MFA_CHALLENGE_REQUIRED", status: 428, actionPath: "/auth/mfa" }
  }
  return { ok: true, userId: posture.userId }
}

export function newestFreshTotpTimestamp(methods: unknown, nowMs = Date.now()): number | null {
  if (!Array.isArray(methods)) return null
  let newest: number | null = null
  for (const item of methods) {
    if (!item || typeof item !== "object" || (item as any).method !== "totp") continue
    const raw = (item as any).timestamp
    const seconds = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN
    if (!Number.isFinite(seconds)) continue
    const value = seconds * 1000
    if (value > nowMs + MFA_CLOCK_SKEW_SECONDS * 1000) continue
    if (nowMs - value <= FRESH_TOTP_MAX_AGE_SECONDS * 1000 && (newest === null || value > newest)) newest = value
  }
  return newest
}

export async function requireFreshTotp(client?: MfaClient, nowMs = Date.now()): Promise<MfaResult> {
  const posture = await getCurrentMfaPosture(client)
  if (!posture.ok) return posture.error === "UNAUTHENTICATED"
    ? { ok: false, error: posture.error, status: 401 }
    : { ok: false, error: posture.error, status: 503 }
  if (posture.verifiedTotp.length === 0) return { ok: false, error: "MFA_ENROLLMENT_REQUIRED", status: 428, actionPath: "/account/security" }
  const freshTotpMs = newestFreshTotpTimestamp(posture.currentAuthenticationMethods, nowMs)
  if (posture.currentLevel !== "aal2" || freshTotpMs === null) {
    return { ok: false, error: "MFA_FRESH_AUTH_REQUIRED", status: 428, actionPath: "/auth/mfa" }
  }
  return { ok: true, userId: posture.userId, freshTotpAt: new Date(freshTotpMs).toISOString() }
}

export function mfaErrorBody(result: Exclude<MfaResult, { ok: true }>) {
  return { error: result.error, ...(result.actionPath ? { actionPath: result.actionPath } : {}) }
}
