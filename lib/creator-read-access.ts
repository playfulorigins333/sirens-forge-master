import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { ensureActiveSubscription, type ActiveSubscriptionResult } from "@/lib/subscription-checker";

export type CreatorReadAccessResult = ActiveSubscriptionResult & {
  accessMode?: "active" | "cancellation_retained";
  readOnly?: boolean;
  paidAccessEndedAt?: string;
  retentionUntil?: string;
};

/** Full entitlement first; fallback is deliberately limited to an owned cancellation record. */
export async function ensureCreatorReadAccess(): Promise<CreatorReadAccessResult> {
  const active = await ensureActiveSubscription();
  if (active.ok) return { ...active, accessMode: "active", readOnly: false };
  if (active.error !== "NO_ACTIVE_SUBSCRIPTION" || !active.user || !active.profile) return active;
  if (active.profile.account_lifecycle_state !== "active") return active;

  const now = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("subscription_cancellation_retentions")
    .select("paid_access_ends_at,retention_until,state,user_subscriptions!inner(status,cancel_at_period_end,stripe_subscription_id,current_period_end,tier_name)")
    .eq("auth_user_id", active.user.id)
    .eq("profile_id", active.profile.id)
    .in("state", ["pending_paid_access_end", "retained_read_only", "expired"])
    .lte("paid_access_ends_at", now)
    .gt("retention_until", now)
    .order("retention_until", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ...active, error: "RETENTION_LOOKUP_FAILED", message: "Retained creator access could not be verified.", status: 503 };
  if (!data) return active;
  const subscription = Array.isArray(data.user_subscriptions) ? data.user_subscriptions[0] : data.user_subscriptions;
  const status = String(subscription?.status || "").toLowerCase();
  const isCancellationSnapshot = status === "canceled"
    || (["active", "trialing"].includes(status) && subscription?.cancel_at_period_end === true);
  if (!isCancellationSnapshot || !subscription?.stripe_subscription_id || subscription.tier_name === "og_throne") return active;

  return {
    ok: true,
    accessMode: "cancellation_retained",
    readOnly: true,
    user: active.user,
    profile: active.profile,
    subscription: null,
    paidAccessEndedAt: data.paid_access_ends_at,
    retentionUntil: data.retention_until,
    status: 200,
  };
}
