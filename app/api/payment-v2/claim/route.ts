import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { paymentFirstClaim, PAYMENT_V2_CLAIM_COOKIE } from "@/lib/payment-v2/claimService";
import { claimDatabase } from "./routeDatabase";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (process.env.PAYMENT_FIRST_CLAIM_V2_ENABLED !== "true") return NextResponse.json({ error: "Payment-first claiming is not active", code: "PAYMENT_FIRST_CLAIM_V2_DISABLED" }, { status: 503 });
  let body: unknown; try { body = await request.json(); } catch { body = null; }
  const parsed = body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 1 && Object.hasOwn(body, "sessionId") ? (body as { sessionId: unknown }).sessionId : null;
  const cookieValues = request.headers.get("cookie")?.split(";").map(v => v.trim()).filter(v => v.startsWith(`${PAYMENT_V2_CLAIM_COOKIE}=`)) || [];
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const result = await paymentFirstClaim({ enabled: process.env.PAYMENT_FIRST_CLAIM_V2_ENABLED, production: process.env.NODE_ENV === "production", configuredOrigin: process.env.PAYMENT_FIRST_CHECKOUT_V2_RETURN_ORIGIN,
    readSessionId: () => parsed, readCookie: () => cookieValues.length === 1 ? cookieValues[0].slice(PAYMENT_V2_CLAIM_COOKIE.length + 1) : undefined,
    readOrigin: () => request.headers.get("origin"), async getAuthenticatedUser() { const auth = await supabaseServer(); const { data, error } = await auth.auth.getUser(); return error ? null : data.user?.id || null; },
    async retrieveSubscription(id) { if (!stripeKey) throw new Error("configuration unavailable"); const stripe = new Stripe(stripeKey, { apiVersion: "2025-11-17.clover" as Stripe.LatestApiVersion }); return await stripe.subscriptions.retrieve(id) as any; },
    createDatabase: claimDatabase });
  const response = NextResponse.json(result.body, { status: result.status });
  if (result.clearCookie) response.cookies.set(PAYMENT_V2_CLAIM_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}
