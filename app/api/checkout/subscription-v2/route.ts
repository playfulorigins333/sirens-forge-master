import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { checkBotId } from "botid/server";
import { checkRateLimit } from "@vercel/firewall";
import { defaultCheckoutDependencies, paymentFirstCheckout, PAYMENT_V2_COOKIE, type PaymentTier } from "@/lib/payment-v2/checkoutService";
import { protectPaymentV2Checkout, PAYMENT_V2_CHECKOUT_RATE_LIMIT_ID } from "@/lib/payment-v2/checkoutRequestProtection";
import { derivePublicPurchaseState } from "@/lib/payment-v2/publicPurchaseReadiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const result = await protectPaymentV2Checkout({
    checkoutEnabled: process.env.PAYMENT_FIRST_CHECKOUT_V2_ENABLED,
    protectionEnabled: process.env.PAYMENT_FIRST_CHECKOUT_V2_PROTECTION_ENABLED,
    configuredOrigin: process.env.PAYMENT_FIRST_CHECKOUT_V2_RETURN_ORIGIN,
    production: process.env.NODE_ENV === "production",
    headers: req.headers,
  }, {
    checkRateLimit: () => checkRateLimit(PAYMENT_V2_CHECKOUT_RATE_LIMIT_ID, { request: req }),
    checkBotId: () => checkBotId(),
    readBody: () => req.text(),
    async processCheckout(request) {
      const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
      const stripeKey = process.env.STRIPE_SECRET_KEY || "";
      if (!url || !key) return { status: 503, body: { error: "Payment-first Checkout is unavailable", code: "PAYMENT_FIRST_CHECKOUT_V2_UNAVAILABLE" } };
      const supabase = createClient(url, key, { auth: { persistSession: false } });
      const readiness = await derivePublicPurchaseState(process.env, {
        now: () => new Date(),
        async loadAffiliateCapability() { const { data, error } = await supabase.rpc("payment_v2_affiliate_public_cutover_ready"); if (error || data !== true) throw new Error("unavailable"); return true; },
        async loadTiers() { const { data, error } = await supabase.from("subscription_tiers").select("name,is_active,stripe_price_id").in("name", ["og_throne", "early_bird"]); if (error || !Array.isArray(data)) throw new Error("unavailable"); return data; },
        async loadInventoryRows() { const { data, error } = await supabase.from("payment_v2_holds").select("tier,state,expires_at"); if (error || !Array.isArray(data)) throw new Error("unavailable"); return data; },
      });
      const tierState = readiness.checkoutMode === "payment_v2" ? readiness.tiers?.[request.tierName] : "unavailable";
      if (tierState === "sold_out") return { status: 409, body: { error: "This tier is sold out", code: "TIER_SOLD_OUT" } };
      if (tierState !== "available" || !stripeKey) return { status: 503, body: { error: "Payment-first Checkout is unavailable", code: "PAYMENT_FIRST_CHECKOUT_V2_UNAVAILABLE" } };
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-11-17.clover" as Stripe.LatestApiVersion });
      const deps = defaultCheckoutDependencies({
        async loadTier(name: PaymentTier) { const { data, error } = await supabase.from("subscription_tiers").select("name,is_active,stripe_price_id").eq("name", name); if (error) throw error; return data || []; },
        async acquireHold(hash, tier, expiresAt, referralCode) { const { data, error } = await supabase.rpc("payment_v2_acquire_hold", { p_purchaser_hash: `\\x${Buffer.from(hash).toString("hex")}`, p_tier: tier, p_expires_at: expiresAt, p_referral_code: referralCode }); if (error) throw new Error(error.message); const row = data?.[0]; if (!row) throw new Error("invalid_request"); return { holdId: row.hold_id, state: row.state, expiresAt: row.expires_at, connectDestination: row.connect_destination, commissionPercent: row.commission_percent == null ? null : Number(row.commission_percent) }; },
        async loadAssociatedSessionId(holdId, hash) { const { data, error } = await supabase.from("payment_v2_holds").select("stripe_checkout_session_id").eq("id", holdId).eq("purchaser_credential_hash", `\\x${Buffer.from(hash).toString("hex")}`).eq("state", "SESSION_ASSOCIATED"); if (error || data?.length !== 1) return null; return data[0].stripe_checkout_session_id; },
        async associateSession(holdId, hash, sessionId) { const { data, error } = await supabase.rpc("payment_v2_associate_session", { p_hold_id: holdId, p_purchaser_hash: `\\x${Buffer.from(hash).toString("hex")}`, p_session_id: sessionId }); if (error) throw error; return data; },
        async createSession(params, idempotencyKey) { return stripe.checkout.sessions.create(params as Stripe.Checkout.SessionCreateParams, { idempotencyKey }); },
        async retrieveSession(id) { return stripe.checkout.sessions.retrieve(id); },
        async loadPriceUnitAmount(id) { const price = await stripe.prices.retrieve(id); return typeof price.unit_amount === "number" ? price.unit_amount : null; },
      });
      return paymentFirstCheckout({
        enabled: process.env.PAYMENT_FIRST_CHECKOUT_V2_ENABLED,
        body: request,
        cookie: req.headers.get("cookie")?.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${PAYMENT_V2_COOKIE}=`))?.slice(PAYMENT_V2_COOKIE.length + 1),
        production: process.env.NODE_ENV === "production",
        configuredOrigin: process.env.PAYMENT_FIRST_CHECKOUT_V2_RETURN_ORIGIN,
      }, deps);
    },
  });
  const response = NextResponse.json(result.body, { status: result.status });
  if (result.cookie) response.cookies.set(result.cookie.name, result.cookie.value, result.cookie);
  return response;
}
