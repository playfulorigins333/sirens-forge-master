// app/api/user/subscription/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("Missing Supabase env vars");
      return NextResponse.json(
        {
          authenticated: false,
          active: false,
          hasProfile: false,
          subscription: null,
          profile: null,
          error: "Server misconfiguration",
        },
        { status: 500 }
      );
    }

    // ✅ FIXED — MUST AWAIT COOKIES()
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("sb-access-token")?.value || null;

    if (!accessToken) {
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

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1) Get user from token
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(accessToken);

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

    // 2) Get profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select(
        `
        id,
        email,
        badge,
        seat_number,
        is_og_member,
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

    // 3) Get latest active/trialing subscription
    const { data: subscription } = await supabase
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

    const isActive =
      !!subscription &&
      (subscription.status === "active" ||
        subscription.status === "trialing");

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
            isOgMember: profile.is_og_member,
            seatNumber: profile.seat_number,
            tokens: profile.tokens,
          },
        },
        { status: 200 }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      {
        authenticated: false,
        active: false,
        hasProfile: false,
        subscription: null,
        profile: null,
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}
