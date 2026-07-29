import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";
import { normalizeReferral } from "@/lib/auth/checkoutContinuation";
import { CHECKOUT_ERROR, LAUNCH_PLAN_POLICY, blocksLaunchCheckout, checkoutSessionIdempotencyKey, isPurchasablePlan, type PurchasablePlan } from "@/lib/billing/launchCheckoutPolicy";
import { createProductionCustomerBoundary, ensureStripeCustomer } from "@/lib/stripe/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type User = { id: string; email?: string | null };
type Profile = { id: string; user_id: string; email?: string | null; stripe_customer_id?: string | null };
type Reservation = { reservation_id: string; expires_at: string; stripe_session_id?: string | null };
export type CheckoutDependencies = {
  authenticate(): Promise<User | null>;
  privileged(): Promise<{
    profiles(userId: string): Promise<Profile[]>; tier(plan: PurchasablePlan): Promise<{ is_active: boolean } | null>;
    entitlements(profileId: string): Promise<unknown[]>; reserve(profileId: string, plan: PurchasablePlan): Promise<Reservation>;
    release(profileId: string, plan: PurchasablePlan, reservationId: string): Promise<void>;
    associate(profileId: string, plan: PurchasablePlan, reservationId: string, sessionId: string): Promise<void>;
    referral(code: string | null): Promise<{ code: string | null; affiliateUserId: string | null; commissionPercent: number; destination: string | null }>;
  }>;
  configuration(plan: PurchasablePlan, request: Request): { priceId: string; baseUrl: string };
  customer(profile: Profile, user: User): Promise<string>;
  createSession(input: any, idempotencyKey: string): Promise<{ id: string; url: string | null }>;
};

const response = (code: string, status: number) => NextResponse.json({ error: code, code }, { status });

export function createCheckoutHandler(deps: CheckoutDependencies) {
  return async (req: Request) => {
    let reservation: { id: string; profileId: string; plan: PurchasablePlan; db: Awaited<ReturnType<CheckoutDependencies["privileged"]>> } | null = null;
    try {
      const user = await deps.authenticate();
      if (!user) return response(CHECKOUT_ERROR.UNAUTHENTICATED, 401);
      const body = await req.json().catch(() => ({}));
      const planValue = body?.tierName ?? body?.tier;
      if (!isPurchasablePlan(planValue)) return response(CHECKOUT_ERROR.PLAN_UNAVAILABLE, 400);
      const db = await deps.privileged();
      const profiles = await db.profiles(user.id);
      if (profiles.length !== 1 || profiles[0].user_id !== user.id || !profiles[0].id) return response(CHECKOUT_ERROR.PROFILE_UNAVAILABLE, 403);
      const profile = profiles[0];
      const tier = await db.tier(planValue);
      if (!tier?.is_active) return response(CHECKOUT_ERROR.PLAN_UNAVAILABLE, 409);
      const entitlements = await db.entitlements(profile.id);
      if (blocksLaunchCheckout(entitlements)) return response(CHECKOUT_ERROR.EXISTING_ENTITLEMENT, 409);
      let held: Reservation;
      try { held = await db.reserve(profile.id, planValue); }
      catch (error: any) { return response(error?.code === "SOLD_OUT" ? CHECKOUT_ERROR.SOLD_OUT : CHECKOUT_ERROR.TEMPORARILY_UNAVAILABLE, 409); }
      reservation = { id: held.reservation_id, profileId: profile.id, plan: planValue, db };
      const config = deps.configuration(planValue, req);
      if (!config.priceId || !config.baseUrl) return response(CHECKOUT_ERROR.TEMPORARILY_UNAVAILABLE, 503);
      const customer = await deps.customer(profile, user);
      const rawReferral = body?.referralCode ?? body?.referral;
      const referralCode = normalizeReferral(rawReferral);
      const referral = await db.referral(referralCode);
      const success = `${config.baseUrl}/pricing?checkout=success&tier=${planValue}`;
      const canceled = `${config.baseUrl}/pricing?checkout=canceled&tier=${planValue}&reservation=${encodeURIComponent(held.reservation_id)}`;
      const metadata = { user_id: user.id, profile_id: profile.id, tier_name: planValue, reservation_id: held.reservation_id,
        referral_code: referral.code || "", affiliate_user_id: referral.affiliateUserId || "", commission_percent: String(referral.commissionPercent) };
      const sessionInput: any = { mode: LAUNCH_PLAN_POLICY[planValue].mode, customer, client_reference_id: profile.id,
        line_items: [{ price: config.priceId, quantity: 1 }], success_url: success, cancel_url: canceled, metadata };
      if (LAUNCH_PLAN_POLICY[planValue].mode === "subscription") sessionInput.subscription_data = { metadata };
      const session = await deps.createSession(sessionInput, checkoutSessionIdempotencyKey(held.reservation_id));
      if (!session.url || !/^https:\/\/checkout\.stripe\.com\//.test(session.url)) throw new Error("provider");
      await db.associate(profile.id, planValue, held.reservation_id, session.id);
      reservation = null;
      return NextResponse.json({ url: session.url });
    } catch {
      if (reservation) await reservation.db.release(reservation.profileId, reservation.plan, reservation.id).catch(() => undefined);
      return response(CHECKOUT_ERROR.PROVIDER_FAILURE, 502);
    }
  };
}

function productionDependencies(): CheckoutDependencies {
  return {
    async authenticate() { const auth = await supabaseServer(); const { data, error } = await auth.auth.getUser(); return error ? null : data.user; },
    async privileged() {
      const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new Error("unavailable"); const db = createClient(url, key);
      return {
        async profiles(userId) { const { data, error } = await db.from("profiles").select("id,user_id,email,stripe_customer_id").eq("user_id", userId).limit(2); if (error) throw error; return data || []; },
        async tier(plan) { const { data, error } = await db.from("subscription_tiers").select("is_active").eq("name", plan).maybeSingle(); if (error) throw error; return data; },
        async entitlements(profileId) { const { data, error } = await db.from("user_subscriptions").select("status,tier_name").eq("user_id", profileId).in("status", ["active","trialing"]); if (error) throw error; return data || []; },
        async reserve(profileId, plan) { const { data, error } = await db.rpc("acquire_checkout_capacity_reservation", { p_profile_id: profileId, p_tier: plan }); if (error || !data?.[0]) { const e:any = new Error("reservation"); e.code = error?.message?.includes("sold_out") ? "SOLD_OUT" : "UNAVAILABLE"; throw e; } return data[0]; },
        async release(profileId, plan, id) { const { error } = await db.rpc("release_checkout_capacity_reservation", { p_reservation_id: id, p_profile_id: profileId, p_tier: plan }); if (error) throw error; },
        async associate(profileId, plan, id, sessionId) { const { error } = await db.rpc("associate_checkout_capacity_session", { p_reservation_id:id,p_profile_id:profileId,p_tier:plan,p_stripe_session_id:sessionId }); if (error) throw error; },
        async referral(code) { if (!code) return { code:null,affiliateUserId:null,commissionPercent:0,destination:null }; const { data } = await db.from("referral_codes").select("affiliate_user_id,commission_percent").eq("code",code).maybeSingle(); return { code:data ? code:null, affiliateUserId:data?.affiliate_user_id||null, commissionPercent:Number(data?.commission_percent)||0,destination:null }; },
      };
    },
    configuration(plan, req) { const priceId = process.env[LAUNCH_PLAN_POLICY[plan].priceEnvironment] || ""; const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL; return { priceId, baseUrl: (configured || new URL(req.url).origin).replace(/\/$/,"") }; },
    async customer(profile,user) { return ensureStripeCustomer({ id:profile.id,userId:user.id,email:user.email||profile.email,stripeCustomerId:profile.stripe_customer_id }, createProductionCustomerBoundary()); },
    async createSession(input,key) { const secret=process.env.STRIPE_SECRET_KEY; if(!secret) throw new Error("unavailable"); return new Stripe(secret,{apiVersion:"2025-11-17.clover"}).checkout.sessions.create(input,{idempotencyKey:key}); },
  };
}
export async function POST(req: Request) { return createCheckoutHandler(productionDependencies())(req); }

export async function DELETE(req: Request) {
  const deps=productionDependencies(); const user=await deps.authenticate(); if(!user) return response(CHECKOUT_ERROR.UNAUTHENTICATED,401);
  const body=await req.json().catch(()=>({})); if(!isPurchasablePlan(body.tier)||typeof body.reservation!=="string") return response(CHECKOUT_ERROR.PLAN_UNAVAILABLE,400);
  try { const db=await deps.privileged(); const profiles=await db.profiles(user.id); if(profiles.length!==1) return response(CHECKOUT_ERROR.PROFILE_UNAVAILABLE,403); await db.release(profiles[0].id,body.tier,body.reservation); return NextResponse.json({released:true}); }
  catch { return response(CHECKOUT_ERROR.TEMPORARILY_UNAVAILABLE,503); }
}
