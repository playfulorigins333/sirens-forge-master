import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ──────────────────────────────────────────────
   Stripe setup
────────────────────────────────────────────── */
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-11-17.clover",
});

/* ──────────────────────────────────────────────
   Supabase (service role)
────────────────────────────────────────────── */
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

/* ──────────────────────────────────────────────
   Launch rules
────────────────────────────────────────────── */
const ACTIVE_STATUSES = ["active", "trialing"] as const;

const LAUNCH_TIERS = ["og_throne", "early_bird", "prime_access"] as const;
type LaunchTier = (typeof LAUNCH_TIERS)[number];

const PRICE_ID_MAP: Record<LaunchTier, string | undefined> = {
  og_throne: process.env.STRIPE_PRICE_OG_THRONE,
  early_bird: process.env.STRIPE_PRICE_EARLY_BIRD,
  prime_access: process.env.STRIPE_PRICE_PRIME_ACCESS,
};

/* ──────────────────────────────────────────────
   Helpers
────────────────────────────────────────────── */
function clampNonNegative(n: number) {
  return n < 0 ? 0 : n;
}

/* ──────────────────────────────────────────────
   POST /api/checkout/subscription
────────────────────────────────────────────── */
export async function POST(req: Request) {
  try {
    const { tierName } = await req.json();

    if (!tierName) {
      return NextResponse.json(
        { error: "Missing tierName" },
        { status: 400 }
      );
    }

    if (!LAUNCH_TIERS.includes(tierName)) {
      return NextResponse.json(
        { error: "Tier not available for launch" },
        { status: 400 }
      );
    }

    const priceId = PRICE_ID_MAP[tierName];
    if (!priceId) {
      return NextResponse.json(
        { error: "Stripe price not configured for tier" },
        { status: 500 }
      );
    }

    /* ──────────────────────────────────────────────
       Seat enforcement (unchanged)
    ────────────────────────────────────────────── */
    const { data: tierRow } = await supabase
      .from("subscription_tiers")
      .select("max_slots")
      .eq("name", tierName)
      .single();

    if (!tierRow) {
      return NextResponse.json(
        { error: "Subscription tier not found" },
        { status: 404 }
      );
    }

    let activeCount = 0;

    if (tierName === "og_throne") {
      const { count: totalOg } = await supabase
        .from("user_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("tier_name", "og_throne")
        .in("status", [...ACTIVE_STATUSES]);

      const { count: excludedOg } = await supabase
        .from("user_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("tier_name", "og_throne")
        .in("status", [...ACTIVE_STATUSES])
        .filter("metadata->>counts_toward_seats", "eq", "false");

      activeCount = clampNonNegative(
        (totalOg ?? 0) - (excludedOg ?? 0)
      );
    } else {
      const { count } = await supabase
        .from("user_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("tier_name", tierName)
        .in("status", [...ACTIVE_STATUSES]);

      activeCount = count ?? 0;
    }

    if (
      typeof tierRow.max_slots === "number" &&
      activeCount >= tierRow.max_slots
    ) {
      return NextResponse.json(
        { error: "This tier is sold out" },
        { status: 409 }
      );
    }

    /* ──────────────────────────────────────────────
       Stripe Checkout
       OG = payment | Others = subscription
    ────────────────────────────────────────────── */
    const session = await stripe.checkout.sessions.create({
      mode: tierName === "og_throne" ? "payment" : "subscription",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing/success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing/cancel`,
      metadata: {
        tier_name: tierName,
        source: "public_pricing",
        type: tierName === "og_throne" ? "lifetime" : "subscription",
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error("❌ Checkout route error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Checkout failed" },
      { status: 500 }
    );
  }
}
