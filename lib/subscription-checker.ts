// lib/subscription-checker.ts
import { supabaseServer } from "@/lib/supabaseServer";
import { hasCurrentMaterialPolicyAcceptance, POLICY_ACCEPTANCE_REQUIRED } from "@/lib/material-policy/service";
import { requireOptInMfaSatisfied } from "@/lib/security/mfa";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type ActiveSubscriptionResult = {
  ok: boolean;
  user?: { id: string; email?: string | null };
  profile?: {
    id: string;
    user_id?: string | null;
    email?: string | null;
    badge?: string | null;
    seat_number?: number | null;
    account_lifecycle_state?: string;
  } | null;
  subscription?: {
    id: string;
    status: string;
    tier_name?: string | null;
    stripe_subscription_id?: string | null;
    current_period_start?: string | null;
    current_period_end?: string | null;
    cancel_at_period_end?: boolean | null;
    canceled_at?: string | null;
    trial_start?: string | null;
    trial_end?: string | null;
  } | null;
  error?: string;
  message?: string;
  status?: number;
};

export async function ensureActiveSubscription(): Promise<ActiveSubscriptionResult> {
  try {
    const supabase = await supabaseServer();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return { ok: false, error: "UNAUTHENTICATED", message: "You must be logged in to access this area.", status: 401 };

    const mfa = await requireOptInMfaSatisfied(supabase);
    if (mfa.ok === false) return { ok: false, user: { id: user.id, email: user.email ?? null }, error: mfa.error, message: "Multi-factor authentication is required.", status: mfa.status };

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id,user_id,email,badge,seat_number,account_lifecycle_state")
      .eq("user_id", user.id)
      .maybeSingle();
    if (profileError) return { ok: false, user: { id: user.id, email: user.email ?? null }, error: "PROFILE_LOOKUP_FAILED", message: profileError.message ?? "Failed to load profile.", status: 500 };
    if (!profile) return { ok: false, user: { id: user.id, email: user.email ?? null }, profile: null, error: "NO_PROFILE", message: "No profile found for this account.", status: 403 };

    const profileResult = {
      id: profile.id,
      user_id: profile.user_id ?? null,
      email: profile.email ?? null,
      badge: profile.badge ?? null,
      seat_number: profile.seat_number ?? null,
      account_lifecycle_state: profile.account_lifecycle_state ?? "active",
    };

    if (profileResult.account_lifecycle_state !== "active") {
      return {
        ok: false,
        user: { id: user.id, email: user.email ?? null },
        profile: profileResult,
        subscription: null,
        error: "ACCOUNT_DELETION_PENDING",
        message: "This account is frozen during its voluntary deletion recovery period. Data rights, billing recovery, security, and reactivation remain available.",
        status: 423,
      };
    }

    const { data: subscription, error: subscriptionError } = await supabase
      .from("user_subscriptions")
      .select("id,status,tier_name,stripe_subscription_id,current_period_start,current_period_end,cancel_at_period_end,canceled_at,trial_start,trial_end")
      .eq("user_id", profile.id)
      .in("status", ["active", "trialing", "canceled"])
      .order("current_period_end", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subscriptionError) return { ok: false, user: { id: user.id, email: user.email ?? null }, profile: profileResult, error: "SUBSCRIPTION_LOOKUP_FAILED", message: subscriptionError.message ?? "Failed to load subscription.", status: 500 };

    const boundary = subscription?.current_period_end ? new Date(subscription.current_period_end).getTime() : Number.NaN;
    const canceledButPaidThroughBoundary = subscription?.status === "canceled"
      && !!subscription.stripe_subscription_id
      && Number.isFinite(boundary)
      && boundary > Date.now();
    const hasActiveSubscription = !!subscription
      && (subscription.status === "active" || subscription.status === "trialing" || canceledButPaidThroughBoundary);
    if (!hasActiveSubscription) return { ok: false, user: { id: user.id, email: user.email ?? null }, profile: profileResult, subscription: null, error: "NO_ACTIVE_SUBSCRIPTION", message: "An active subscription is required to access this area.", status: 402 };

    const isLifetime = subscription.tier_name === "og_throne" && !subscription.stripe_subscription_id;
    if (!isLifetime) {
      if (!subscription.stripe_subscription_id || !subscription.current_period_end) {
        return { ok: false, user: { id: user.id, email: user.email ?? null }, profile: profileResult, subscription, error: "MALFORMED_SUBSCRIPTION", message: "Subscription access could not be verified.", status: 503 };
      }
      const paidAccessEndsAt = new Date(subscription.current_period_end).getTime();
      if (!Number.isFinite(paidAccessEndsAt)) {
        return { ok: false, user: { id: user.id, email: user.email ?? null }, profile: profileResult, subscription, error: "MALFORMED_SUBSCRIPTION", message: "Subscription access could not be verified.", status: 503 };
      }
      if (paidAccessEndsAt <= Date.now()) {
        return { ok: false, user: { id: user.id, email: user.email ?? null }, profile: profileResult, subscription, error: "NO_ACTIVE_SUBSCRIPTION", message: "Paid subscription access has ended.", status: 402 };
      }
      const { data: delinquency, error: delinquencyError } = await getSupabaseAdmin()
        .from("subscription_payment_delinquencies")
        .select("id")
        .eq("auth_user_id", user.id)
        .eq("profile_id", profile.id)
        .eq("subscription_id", subscription.id)
        .in("state", ["first_miss_frozen", "retention_countdown"])
        .limit(1)
        .maybeSingle();
      if (delinquencyError) {
        return { ok: false, user: { id: user.id, email: user.email ?? null }, profile: profileResult, subscription, error: "DELINQUENCY_LOOKUP_FAILED", message: "Payment status could not be verified.", status: 503 };
      }
      if (delinquency) {
        return { ok: false, user: { id: user.id, email: user.email ?? null }, profile: profileResult, subscription, error: "PAYMENT_DELINQUENT", message: "Creator tools are temporarily frozen while payment recovery is required. Billing, account security, privacy, and data rights remain available.", status: 402 };
      }
    }

    try {
      if (!(await hasCurrentMaterialPolicyAcceptance(user.id, profile.id))) {
        return { ok: false, user: { id: user.id, email: user.email ?? null }, profile: profileResult, subscription, error: POLICY_ACCEPTANCE_REQUIRED, message: "Current material policy acceptance is required.", status: 428 };
      }
    } catch {
      return { ok: false, user: { id: user.id, email: user.email ?? null }, profile: profileResult, subscription, error: "POLICY_ACCEPTANCE_LOOKUP_FAILED", message: "Policy acceptance status is temporarily unavailable.", status: 503 };
    }

    return {
      ok: true,
      user: { id: user.id, email: user.email ?? null },
      profile: profileResult,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        tier_name: subscription.tier_name ?? null,
        stripe_subscription_id: subscription.stripe_subscription_id ?? null,
        current_period_start: subscription.current_period_start ?? null,
        current_period_end: subscription.current_period_end ?? null,
        cancel_at_period_end: subscription.cancel_at_period_end ?? null,
        canceled_at: subscription.canceled_at ?? null,
        trial_start: subscription.trial_start ?? null,
        trial_end: subscription.trial_end ?? null,
      },
      status: 200,
    };
  } catch (err: any) {
    const unauthorized = err?.message === "Unauthorized" || err?.message === "Auth session missing!";
    if (unauthorized) return { ok: false, error: "UNAUTHENTICATED", message: "You must be logged in to access this area.", status: 401 };
    return { ok: false, error: "INTERNAL_ERROR", message: err?.message ?? "Unknown error", status: 500 };
  }
}
