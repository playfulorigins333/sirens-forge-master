// lib/subscription-checker.ts
import { supabaseServer } from "@/lib/supabaseServer";

export type ActiveSubscriptionResult = {
  ok: boolean;
  user?: {
    id: string;
    email?: string | null;
  };
  profile?: {
    id: string;
    user_id?: string | null;
    email?: string | null;
    badge?: string | null;
    seat_number?: number | null;
    is_og_member?: boolean | null;
    tokens?: number | null;
  } | null;
  subscription?: {
    id: string;
    status: string;
    tier_name?: string | null;
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

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        ok: false,
        error: "UNAUTHENTICATED",
        message: "You must be logged in to access this area.",
        status: 401,
      };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select(
        `
        id,
        user_id,
        email,
        badge,
        seat_number,
        is_og_member,
        tokens
      `
      )
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      return {
        ok: false,
        user: {
          id: user.id,
          email: user.email ?? null,
        },
        error: "PROFILE_LOOKUP_FAILED",
        message: profileError.message ?? "Failed to load profile.",
        status: 500,
      };
    }

    if (!profile) {
      return {
        ok: false,
        user: {
          id: user.id,
          email: user.email ?? null,
        },
        profile: null,
        error: "NO_PROFILE",
        message: "No profile found for this account.",
        status: 403,
      };
    }

    const { data: subscription, error: subscriptionError } = await supabase
      .from("user_subscriptions")
      .select(
        `
        id,
        status,
        tier_name,
        current_period_start,
        current_period_end,
        cancel_at_period_end,
        canceled_at,
        trial_start,
        trial_end
      `
      )
      .eq("user_id", profile.id)
      .in("status", ["active", "trialing"])
      .order("current_period_end", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subscriptionError) {
      return {
        ok: false,
        user: {
          id: user.id,
          email: user.email ?? null,
        },
        profile,
        error: "SUBSCRIPTION_LOOKUP_FAILED",
        message: subscriptionError.message ?? "Failed to load subscription.",
        status: 500,
      };
    }

    const hasActiveSubscription =
      !!subscription &&
      (subscription.status === "active" || subscription.status === "trialing");

    if (!hasActiveSubscription) {
      return {
        ok: false,
        user: {
          id: user.id,
          email: user.email ?? null,
        },
        profile,
        subscription: null,
        error: "NO_ACTIVE_SUBSCRIPTION",
        message: "An active subscription is required to access this area.",
        status: 402,
      };
    }

    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email ?? null,
      },
      profile,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        tier_name: subscription.tier_name ?? null,
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
    const unauthorized =
      err?.message === "Unauthorized" ||
      err?.message === "Auth session missing!";

    if (unauthorized) {
      return {
        ok: false,
        error: "UNAUTHENTICATED",
        message: "You must be logged in to access this area.",
        status: 401,
      };
    }

    return {
      ok: false,
      error: "INTERNAL_ERROR",
      message: err?.message ?? "Unknown error",
      status: 500,
    };
  }
}