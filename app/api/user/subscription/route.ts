// app/api/user/subscription/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await supabaseServer();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        {
          authenticated: false,
          active: false,
          hasProfile: false,
          subscription: null,
          profile: null,
        },
        { status: 200 }
      );
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
        tokens
      `
      )
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return NextResponse.json(
        {
          authenticated: true,
          active: false,
          hasProfile: false,
          subscription: null,
          profile: null,
        },
        { status: 200 }
      );
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
      return NextResponse.json(
        {
          authenticated: true,
          active: false,
          hasProfile: true,
          subscription: null,
          profile: {
            id: profile.id,
            email: profile.email,
            badge: profile.badge,
            seatNumber: profile.seat_number,
            tokens: profile.tokens,
          },
          error: subscriptionError.message ?? "Failed to load subscription",
        },
        { status: 200 }
      );
    }

    const isActive =
      !!subscription &&
      (subscription.status === "active" || subscription.status === "trialing");

    return NextResponse.json(
      {
        authenticated: true,
        active: isActive,
        hasProfile: true,
        subscription: subscription
          ? {
              id: subscription.id,
              status: subscription.status,
              tierName: subscription.tier_name,
              currentPeriodStart: subscription.current_period_start,
              currentPeriodEnd: subscription.current_period_end,
              cancelAtPeriodEnd: subscription.cancel_at_period_end,
              canceledAt: subscription.canceled_at,
              trialStart: subscription.trial_start,
              trialEnd: subscription.trial_end,
            }
          : null,
        profile: {
          id: profile.id,
          email: profile.email,
          badge: profile.badge,
          seatNumber: profile.seat_number,
          tokens: profile.tokens,
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Unexpected error in /api/user/subscription:", err);

    return NextResponse.json(
      {
        authenticated: false,
        active: false,
        hasProfile: false,
        subscription: null,
        profile: null,
        error: err?.message ?? "Internal server error",
      },
      { status: 500 }
    );
  }
}