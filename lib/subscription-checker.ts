// lib/subscription-checker.ts
import { supabase } from "@/lib/supabase";

export type ActiveSubscriptionResult = {
  ok: boolean;
  user?: any;
  subscription?: any;
  error?: string;
  message?: string;
  status?: number;
};

export async function ensureActiveSubscription(): Promise<ActiveSubscriptionResult> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    console.error("[Subscription Checker] auth error:", authError);
  }

  // Not logged in
  if (!user) {
    return {
      ok: false,
      error: "UNAUTHENTICATED",
      message: "You must be logged in to use the generator.",
      status: 401,
    };
  }

  // Look up latest subscription for this user
  const { data, error } = await supabase
    .from("user_subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .in("status", ["active", "trialing"])
    .order("current_period_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[Subscription Checker] DB Error:", error);
  }

  const now = new Date();
  const active =
    data &&
    (data.status === "active" || data.status === "trialing") &&
    new Date(data.current_period_end).getTime() > now.getTime();

  if (!active) {
    return {
      ok: false,
      error: "SUBSCRIPTION_REQUIRED",
      message:
        "An active subscription is required to use the SirensForge generator.",
      status: 402,
    };
  }

  return {
    ok: true,
    user,
    subscription: data,
  };
}
