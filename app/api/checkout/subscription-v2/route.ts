import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { defaultCheckoutDependencies, paymentFirstCheckout, PAYMENT_V2_COOKIE, type PaymentTier } from "@/lib/payment-v2/checkoutService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function baseUrl(req: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  return host ? `${req.headers.get("x-forwarded-proto") || "https"}://${host}` : "";
}

export async function POST(req: Request) {
  if (process.env.PAYMENT_FIRST_CHECKOUT_V2_ENABLED !== "true") {
    return NextResponse.json({ error: "Payment-first Checkout is not active", code: "PAYMENT_FIRST_CHECKOUT_V2_DISABLED" }, { status: 503 });
  }
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid Checkout request", code: "INVALID_CHECKOUT_REQUEST" }, { status: 400 }); }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const stripeKey = process.env.STRIPE_SECRET_KEY || "";
  if (!url || !key || !stripeKey) return NextResponse.json({ error: "Unable to start Checkout", code: "PAYMENT_FIRST_CHECKOUT_V2_ERROR" }, { status: 500 });
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const stripe = new Stripe(stripeKey, { apiVersion: "2025-11-17.clover" as Stripe.LatestApiVersion });
  const deps = defaultCheckoutDependencies({
    async loadTier(name: PaymentTier) { const { data, error } = await supabase.from("subscription_tiers").select("name,is_active,stripe_price_id").eq("name", name); if (error) throw error; return data || []; },
    async acquireHold(hash, tier, expiresAt) { const { data, error } = await supabase.rpc("payment_v2_acquire_hold", { p_purchaser_hash: `\\x${Buffer.from(hash).toString("hex")}`, p_tier: tier, p_expires_at: expiresAt }); if (error) throw new Error(error.message); const row = data?.[0]; if (!row) throw new Error("invalid_request"); return { holdId: row.hold_id, state: row.state }; },
    async loadAssociatedSessionId(holdId, hash) { const { data, error } = await supabase.from("payment_v2_holds").select("stripe_checkout_session_id").eq("id", holdId).eq("purchaser_credential_hash", `\\x${Buffer.from(hash).toString("hex")}`).eq("state", "SESSION_ASSOCIATED"); if (error || data?.length !== 1) return null; return data[0].stripe_checkout_session_id; },
    async associateSession(holdId, hash, sessionId) { const { data, error } = await supabase.rpc("payment_v2_associate_session", { p_hold_id: holdId, p_purchaser_hash: `\\x${Buffer.from(hash).toString("hex")}`, p_session_id: sessionId }); if (error) throw error; return data; },
    async resolveReferral(code) {
      const { data: refs, error } = await supabase.from("referral_codes").select("*").eq("code", code);
      if (error || refs?.length !== 1) return null;
      const row = refs[0] as Record<string, unknown>; const owner = row.affiliate_user_id || row.affiliate_id || row.user_id || row.owner_user_id;
      const commission = Number(row.commission_percent ?? row.commission_rate);
      if (typeof owner !== "string" || !Number.isFinite(commission)) return null;
      const { data: profiles, error: profileError } = await supabase.from("profiles").select("stripe_connect_account_id,stripe_connect_onboarded").eq("id", owner);
      if (profileError || profiles?.length !== 1 || profiles[0].stripe_connect_onboarded !== true || typeof profiles[0].stripe_connect_account_id !== "string") return null;
      return { destination: profiles[0].stripe_connect_account_id, commissionPercent: commission };
    },
    async retrievePriceUnitAmount(priceId) { return (await stripe.prices.retrieve(priceId)).unit_amount; },
    async createSession(params, idempotencyKey) { return stripe.checkout.sessions.create(params as Stripe.Checkout.SessionCreateParams, { idempotencyKey }); },
    async retrieveSession(id) { return stripe.checkout.sessions.retrieve(id); },
  });
  const result = await paymentFirstCheckout({ enabled: process.env.PAYMENT_FIRST_CHECKOUT_V2_ENABLED, body,
    cookie: req.headers.get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(`${PAYMENT_V2_COOKIE}=`))?.slice(PAYMENT_V2_COOKIE.length + 1),
    production: process.env.NODE_ENV === "production", baseUrl: baseUrl(req) }, deps);
  const response = NextResponse.json(result.body, { status: result.status });
  if (result.cookie) response.cookies.set(result.cookie.name, result.cookie.value, result.cookie);
  return response;
}
