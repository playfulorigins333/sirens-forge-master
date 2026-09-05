import "server-only"

import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { hasCurrentMaterialPolicyAcceptance } from "@/lib/material-policy/service"

export type CreatorProductExecutionAccess =
  | { ok: true; authUserId: string; profileId: string; subscriptionId: string; lifetime: boolean }
  | {
      ok: false
      code:
        | "PROFILE_LOOKUP_FAILED"
        | "NO_PROFILE"
        | "ACCOUNT_DELETION_PENDING"
        | "SUBSCRIPTION_LOOKUP_FAILED"
        | "DELINQUENCY_LOOKUP_FAILED"
        | "PAYMENT_DELINQUENT"
        | "NO_ACTIVE_SUBSCRIPTION"
        | "MALFORMED_SUBSCRIPTION"
        | "POLICY_ACCEPTANCE_REQUIRED"
        | "POLICY_ACCEPTANCE_LOOKUP_FAILED"
    }

/**
 * Service-side equivalent of the paid creator-product gate for background/internal
 * execution paths that do not have a browser session. This intentionally does not
 * perform an MFA session check: a background job has no user session to elevate.
 * It does re-check the durable account, billing, delinquency, OG/lifetime, paid
 * period, and material-policy boundaries immediately before product execution.
 */
export async function checkCreatorProductExecutionAccess(
  authUserId: string,
): Promise<CreatorProductExecutionAccess> {
  const admin = getSupabaseAdmin()

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,account_lifecycle_state")
    .eq("user_id", authUserId)
    .maybeSingle()
  if (profileError) return { ok: false, code: "PROFILE_LOOKUP_FAILED" }
  if (!profile) return { ok: false, code: "NO_PROFILE" }
  if ((profile.account_lifecycle_state ?? "active") !== "active") {
    return { ok: false, code: "ACCOUNT_DELETION_PENDING" }
  }

  const { data: subscription, error: subscriptionError } = await admin
    .from("user_subscriptions")
    .select("id,status,tier_name,stripe_subscription_id,current_period_end")
    .eq("user_id", profile.id)
    .in("status", ["active", "trialing", "past_due", "unpaid", "canceled"])
    .order("current_period_end", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (subscriptionError) return { ok: false, code: "SUBSCRIPTION_LOOKUP_FAILED" }
  if (!subscription) return { ok: false, code: "NO_ACTIVE_SUBSCRIPTION" }

  const lifetime = subscription.tier_name === "og_throne" && !subscription.stripe_subscription_id

  if (subscription.stripe_subscription_id && !lifetime) {
    const { data: delinquency, error: delinquencyError } = await admin
      .from("subscription_payment_delinquencies")
      .select("id")
      .eq("auth_user_id", authUserId)
      .eq("profile_id", profile.id)
      .eq("subscription_id", subscription.id)
      .in("state", ["first_miss_frozen", "retention_countdown"])
      .limit(1)
      .maybeSingle()
    if (delinquencyError) return { ok: false, code: "DELINQUENCY_LOOKUP_FAILED" }
    if (delinquency) return { ok: false, code: "PAYMENT_DELINQUENT" }
  }

  const boundary = subscription.current_period_end
    ? new Date(subscription.current_period_end).getTime()
    : Number.NaN
  const canceledButPaidThroughBoundary =
    subscription.status === "canceled" &&
    !!subscription.stripe_subscription_id &&
    Number.isFinite(boundary) &&
    boundary > Date.now()
  const active =
    subscription.status === "active" ||
    subscription.status === "trialing" ||
    canceledButPaidThroughBoundary
  if (!active) return { ok: false, code: "NO_ACTIVE_SUBSCRIPTION" }

  if (!lifetime) {
    if (!subscription.stripe_subscription_id || !subscription.current_period_end) {
      return { ok: false, code: "MALFORMED_SUBSCRIPTION" }
    }
    if (!Number.isFinite(boundary)) return { ok: false, code: "MALFORMED_SUBSCRIPTION" }
    if (boundary <= Date.now()) return { ok: false, code: "NO_ACTIVE_SUBSCRIPTION" }
  }

  try {
    if (!(await hasCurrentMaterialPolicyAcceptance(authUserId, profile.id))) {
      return { ok: false, code: "POLICY_ACCEPTANCE_REQUIRED" }
    }
  } catch {
    return { ok: false, code: "POLICY_ACCEPTANCE_LOOKUP_FAILED" }
  }

  return {
    ok: true,
    authUserId,
    profileId: profile.id,
    subscriptionId: subscription.id,
    lifetime,
  }
}
