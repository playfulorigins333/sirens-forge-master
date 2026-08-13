import { redirect } from "next/navigation"
import { ensureActiveSubscription } from "../subscription-checker"

export async function activeCreatorIdOrNull(): Promise<string | null> {
  const auth = await ensureActiveSubscription()
  return auth.ok && auth.user?.id ? auth.user.id : null
}

export async function requireActiveCreatorIdentity(): Promise<{ authUserId: string; profileId: string | null }> {
  const auth = await ensureActiveSubscription()
  if (!auth.ok || !auth.user?.id) {
    const error = new Error(auth.error ?? "SUBSCRIPTION_REQUIRED")
    ;(error as Error & { code?: string; status?: number }).code = auth.error
    ;(error as Error & { code?: string; status?: number }).status = auth.status
    throw error
  }
  return { authUserId: auth.user.id, profileId: auth.profile?.id ?? null }
}

export async function requireActiveCreatorId(): Promise<string> {
  const auth = await ensureActiveSubscription()
  if (!auth.ok || !auth.user?.id) {
    const error = new Error(auth.error ?? "SUBSCRIPTION_REQUIRED")
    ;(error as Error & { code?: string; status?: number }).code = auth.error
    ;(error as Error & { code?: string; status?: number }).status = auth.status
    throw error
  }
  return auth.user.id
}

export async function requireActiveCreatorPageIdentity(): Promise<{ authUserId: string; profileId: string | null }> {
  const auth = await ensureActiveSubscription()
  if (!auth.ok || !auth.user?.id) {
    if (auth.error === "UNAUTHENTICATED") redirect("/login")
    redirect("/pricing")
  }
  return { authUserId: auth.user.id, profileId: auth.profile?.id ?? null }
}
