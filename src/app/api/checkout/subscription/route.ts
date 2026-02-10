// app/api/checkout/subscription/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ──────────────────────────────────────────────
   Stripe setup
────────────────────────────────────────────── */
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-11-17.clover" as any,
});

/* ──────────────────────────────────────────────
   Supabase (service role – authoritative)
────────────────────────────────────────────── */
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "";

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";

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

function safeString(v: unknown) {
  if (typeof v !== "string") return "";
  return v.trim();
}

function toPercentNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function clampPercent(n: number) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function getBaseUrl(req: Request) {
  // Prefer explicit env (best practice)
  const env = safeString(process.env.NEXT_PUBLIC_APP_URL);
  if (env) return env.replace(/\/+$/, "");

  // Fallback: derive from request (prevents deploy-time “undefined URL” issues)
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const derived = host ? `${proto}://${host}` : "";
  return derived.replace(/\/+$/, "");
}

function missingEnv(keys: string[]) {
  return keys.filter((k) => !safeString((process.env as any)[k]));
}

type ReferralResolution = {
  ok: boolean;
  referralCode: string | null;
  affiliateUserId: string | null;
  commissionPercent: number; // 0..100
  connectAccountId: string | null;
  connectOnboarded: boolean;
};

async function resolveReferral(referralCodeRaw: unknown): Promise<ReferralResolution> {
  const referralCode = safeString(referralCodeRaw);

  if (!referralCode) {
    return {
      ok: false,
      referralCode: null,
      affiliateUserId: null,
      commissionPercent: 0,
      connectAccountId: null,
      connectOnboarded: false,
    };
  }

  const { data: referralRow, error: refErr } = await supabase
    .from("referral_codes")
    .select("*")
    .eq("code", referralCode)
    .maybeSingle();

  if (refErr || !referralRow) {
    return {
      ok: false,
      referralCode,
      affiliateUserId: null,
      commissionPercent: 0,
      connectAccountId: null,
      connectOnboarded: false,
    };
  }

  const affiliateUserId =
    safeString((referralRow as any).affiliate_user_id) ||
    safeString((referralRow as any).affiliate_id) ||
    safeString((referralRow as any).user_id) ||
    safeString((referralRow as any).owner_user_id) ||
    null;

  const maybePercent =
    toPercentNumber((referralRow as any).commission_percent) ??
    toPercentNumber((referralRow as any).commissionPercent) ??
    toPercentNumber((referralRow as any).percent) ??
    toPercentNumber((referralRow as any).commission_rate) ??
    null;

  const commissionPercent = clampPercent(maybePercent ?? 0);

  if (!affiliateUserId) {
    return {
      ok: true,
      referralCode,
      affiliateUserId: null,
      commissionPercent,
      connectAccountId: null,
      connectOnboarded: false,
    };
  }

  const { data: profileRow, error: profErr } = await supabase
    .from("profiles")
    .select("stripe_connect_account_id, stripe_connect_onboarded")
    .eq("id", affiliateUserId)
    .maybeSingle();

  if (profErr || !profileRow) {
    return {
      ok: true,
      referralCode,
      affiliateUserId,
      commissionPercent,
      connectAccountId: null,
      connectOnboarded: false,
    };
  }

  const connectAccountId = safeString((profileRow as any).stripe_connect_account_id) || null;
  const connectOnboarded = Boolean((profileRow as any).stripe_connect_onboarded);

  const payable = connectOnboarded && !!connectAccountId;

  return {
    ok: true,
    referralCode,
    affiliateUserId,
    commissionPercent,
    connectAccountId: payable ? connectAccountId : null,
    connectOnboarded: payable,
  };
}

async function computePlatformFeeAmountCents(
  priceId: string,
  platformFeePercent: number
): Promise<number> {
  const price = await stripe.prices.retrieve(priceId);
  const unitAmount = typeof price.unit_amount === "number" ? price.unit_amount : null;

  if (unitAmount == null) {
    throw new Error("Price unit_amount missing — cannot compute application_fee_amount.");
  }

  const fee = Math.round((unitAmount * clampPercent(platformFeePercent)) / 100);
  return fee < 0 ? 0 : fee;
}

/* ──────────────────────────────────────────────
   POST /api/checkout/subscription
────────────────────────────────────────────── */
export async function POST(req: Request) {
  try {
    // Hard guardrails: fail with clear server error (not silent)
    const missing = [
      ...missingEnv(["STRIPE_SECRET_KEY"]),
      ...(SUPABASE_URL ? [] : ["SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL"]),
      ...(SERVICE_ROLE_KEY ? [] : ["SUPABASE_SERVICE_ROLE_KEY"]),
    ];

    if (missing.length > 0) {
      console.error("❌ Missing required env:", missing);
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missing.join(", ")}` },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({} as any));

    const tierName = body?.tierName as LaunchTier | undefined;
    const referralCode = body?.referralCode;

    if (!tierName) {
      return NextResponse.json({ error: "Missing tierName" }, { status: 400 });
    }

    if (!LAUNCH_TIERS.includes(tierName)) {
      return NextResponse.json({ error: "Tier not available for launch" }, { status: 400 });
    }

    const priceId = PRICE_ID_MAP[tierName];
    if (!priceId) {
      console.error("❌ Missing Stripe price env for tier:", tierName);
      return NextResponse.json({ error: "Stripe price not configured for tier" }, { status: 500 });
    }

    const baseUrl = getBaseUrl(req);
    if (!baseUrl) {
      console.error("❌ Could not determine base URL (NEXT_PUBLIC_APP_URL missing and host unavailable)");
      return NextResponse.json({ error: "Server misconfigured: app URL missing" }, { status: 500 });
    }

    const successUrl = `${baseUrl}/billing/success`;
    const cancelUrl = `${baseUrl}/billing/cancel`;

    /* ──────────────────────────────────────────────
       1️⃣ Load tier limits
    ────────────────────────────────────────────── */
    const { data: tierRow, error: tierErr } = await supabase
      .from("subscription_tiers")
      .select("id, max_slots")
      .eq("name", tierName)
      .single();

    if (tierErr || !tierRow) {
      return NextResponse.json({ error: "Subscription tier not found" }, { status: 404 });
    }

    /* ──────────────────────────────────────────────
       2️⃣ Count active subscriptions
       (OG excludes testers)
    ────────────────────────────────────────────── */
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

      activeCount = clampNonNegative((totalOg ?? 0) - (excludedOg ?? 0));
    } else {
      const { count } = await supabase
        .from("user_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("tier_name", tierName)
        .in("status", [...ACTIVE_STATUSES]);

      activeCount = count ?? 0;
    }

    if (typeof tierRow.max_slots === "number" && activeCount >= tierRow.max_slots) {
      return NextResponse.json({ error: "This tier is sold out" }, { status: 409 });
    }

    /* ──────────────────────────────────────────────
       2.5️⃣ Resolve referral (optional)
    ────────────────────────────────────────────── */
    const referral = await resolveReferral(referralCode);

    const platformFeePercent = clampPercent(100 - referral.commissionPercent);

    const sharedMetadata: Record<string, string> = {
      tier_name: tierName,
      referral_code: referral.referralCode ?? "",
      affiliate_user_id: referral.affiliateUserId ?? "",
      commission_percent: String(referral.commissionPercent),
      platform_fee_percent: String(platformFeePercent),
      connect_destination_account: referral.connectAccountId ?? "",
      connect_onboarded: referral.connectOnboarded ? "true" : "false",
    };

    /* ──────────────────────────────────────────────
       3️⃣ Create Stripe Checkout Session
    ────────────────────────────────────────────── */

    // OG = ONE-TIME PAYMENT
    if (tierName === "og_throne") {
      if (referral.connectOnboarded && referral.connectAccountId) {
        const applicationFeeAmount = await computePlatformFeeAmountCents(priceId, platformFeePercent);

        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: { ...sharedMetadata, type: "one_time", connect_mode: "destination_charge" },
          payment_intent_data: {
            application_fee_amount: applicationFeeAmount,
            transfer_data: { destination: referral.connectAccountId },
            metadata: { ...sharedMetadata, type: "one_time", connect_mode: "destination_charge" },
          },
        });

        return NextResponse.json({ url: session.url });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { ...sharedMetadata, type: "one_time", connect_mode: "none" },
        payment_intent_data: {
          metadata: { ...sharedMetadata, type: "one_time", connect_mode: "none" },
        },
      });

      return NextResponse.json({ url: session.url });
    }

    // EARLY BIRD / PRIME = SUBSCRIPTION
    if (referral.connectOnboarded && referral.connectAccountId) {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { ...sharedMetadata, type: "subscription", connect_mode: "destination_charge" },
        subscription_data: {
          application_fee_percent: platformFeePercent,
          transfer_data: { destination: referral.connectAccountId },
          metadata: { ...sharedMetadata, type: "subscription", connect_mode: "destination_charge" },
        },
      });

      return NextResponse.json({ url: session.url });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { ...sharedMetadata, type: "subscription", connect_mode: "none" },
      subscription_data: {
        metadata: { ...sharedMetadata, type: "subscription", connect_mode: "none" },
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
