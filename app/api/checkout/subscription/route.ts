import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";
import { normalizeReferral } from "@/lib/auth/checkoutContinuation";
import { CHECKOUT_ERROR, LAUNCH_CHECKOUT_CONTRACT, LAUNCH_PLAN_POLICY, blocksLaunchCheckout, checkoutSessionIdempotencyKey, isPurchasablePlan, paymentMethodTypesForLaunchPlan, type PurchasablePlan } from "@/lib/billing/launchCheckoutPolicy";
import { createProductionCustomerBoundary, ensureStripeCustomer } from "@/lib/stripe/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type User = { id: string; email?: string | null };
type Profile = { id: string; user_id: string; email?: string | null; stripe_customer_id?: string | null };
type Reservation = { reservation_id: string; expires_at: string; stripe_session_id?: string | null };
type Referral = { code: string | null; affiliateUserId: string | null; commissionPercent: number; destination: string | null; connectOnboarded: boolean; payable: boolean };
export type CheckoutDependencies = {
  authenticate(): Promise<User | null>;
  privileged(): Promise<{
    profiles(userId: string): Promise<Profile[]>; tier(plan: PurchasablePlan): Promise<{ is_active: boolean } | null>;
    entitlements(profileId: string): Promise<unknown[]>; reserve(profileId: string, plan: PurchasablePlan): Promise<Reservation>;
    release(profileId: string, plan: PurchasablePlan, reservationId: string): Promise<void>;
    associate(profileId: string, plan: PurchasablePlan, reservationId: string, sessionId: string): Promise<void>;
    referral(code: string | null): Promise<Referral>;
  }>;
  configuration(plan: PurchasablePlan, request: Request): { priceId: string; baseUrl: string };
  customer(profile: Profile, user: User): Promise<string>;
  retrievePrice(priceId: string): Promise<{ unitAmount: number | null }>;
  createSession(input: any, idempotencyKey: string): Promise<{ id: string; url: string | null }>;
};

const response = (code: string, status: number) => NextResponse.json({ error: code, code }, { status });
export const clampCommissionPercent = (value: unknown) => Math.min(100, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0));

export function createCheckoutHandler(deps: CheckoutDependencies) {
  return async (req: Request) => {
    let reservation: { id: string; profileId: string; plan: PurchasablePlan; db: Awaited<ReturnType<CheckoutDependencies["privileged"]>> } | null = null;
    let sessionCreated = false;
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
      catch (error: any) {
        if (error?.code === "SOLD_OUT") return response(CHECKOUT_ERROR.SOLD_OUT, 409);
        if (["EXISTING_ENTITLEMENT", "RESERVATION_CONFLICT"].includes(error?.code)) return response(CHECKOUT_ERROR.EXISTING_ENTITLEMENT, 409);
        return response(CHECKOUT_ERROR.TEMPORARILY_UNAVAILABLE, 503);
      }
      reservation = { id: held.reservation_id, profileId: profile.id, plan: planValue, db };
      const config = deps.configuration(planValue, req);
      if (!config.priceId || !config.baseUrl) throw new Error("configuration");
      const customer = await deps.customer(profile, user);
      const rawReferral = body?.referralCode ?? body?.referral;
      const referralCode = normalizeReferral(rawReferral);
      const referral = await db.referral(referralCode);
      const commissionPercent = clampCommissionPercent(referral.commissionPercent);
      const platformFeePercent = clampCommissionPercent(100 - commissionPercent);
      const connectMode = referral.payable && referral.connectOnboarded && referral.destination ? "destination_charge" : "none";
      const success = `${config.baseUrl}/pricing?checkout=success&tier=${planValue}`;
      const canceled = `${config.baseUrl}/pricing?checkout=canceled&tier=${planValue}&reservation=${encodeURIComponent(held.reservation_id)}`;
      const metadata = { checkout_contract: LAUNCH_CHECKOUT_CONTRACT, user_id: user.id, profile_id: profile.id, tier_name: planValue, stripe_price_id: config.priceId, stripe_customer_id: customer, reservation_id: held.reservation_id,
        referral_code: referral.code || "", affiliate_user_id: referral.affiliateUserId || "", commission_percent: String(commissionPercent),
        platform_fee_percent: String(platformFeePercent), connect_destination_account: referral.destination || "",
        connect_onboarded: referral.connectOnboarded ? "true" : "false", type: LAUNCH_PLAN_POLICY[planValue].mode === "payment" ? "one_time" : "subscription", connect_mode: connectMode };
      const expiresAt = Math.floor(new Date(held.expires_at).getTime() / 1000);
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("reservation");
      const sessionInput: any = { mode: LAUNCH_PLAN_POLICY[planValue].mode, customer, client_reference_id: profile.id,
        payment_method_types: paymentMethodTypesForLaunchPlan(planValue, process.env.STRIPE_OG_BNPL_METHODS), line_items: [{ price: config.priceId, quantity: 1 }], success_url: success, cancel_url: canceled, expires_at: expiresAt, metadata };
      if (LAUNCH_PLAN_POLICY[planValue].mode === "payment") {
        sessionInput.payment_intent_data = { metadata };
        if (connectMode === "destination_charge") {
          const price = await deps.retrievePrice(config.priceId);
          if (!Number.isSafeInteger(price.unitAmount) || (price.unitAmount as number) < 0) throw new Error("price");
          sessionInput.payment_intent_data.application_fee_amount = Math.round((price.unitAmount as number) * platformFeePercent / 100);
          sessionInput.payment_intent_data.transfer_data = { destination: referral.destination };
        }
      } else {
        sessionInput.subscription_data = { metadata };
        if (connectMode === "destination_charge") {
          sessionInput.subscription_data.application_fee_percent = platformFeePercent;
          sessionInput.subscription_data.transfer_data = { destination: referral.destination };
        }
      }
      const session = await deps.createSession(sessionInput, checkoutSessionIdempotencyKey(held.reservation_id));
      sessionCreated = true;
      if (!session.url || !/^https:\/\/checkout\.stripe\.com\//.test(session.url)) throw new Error("provider");
      await db.associate(profile.id, planValue, held.reservation_id, session.id);
      reservation = null;
      return NextResponse.json({ url: session.url });
    } catch (error) {
      if (reservation && !sessionCreated) await reservation.db.release(reservation.profileId, reservation.plan, reservation.id).catch(() => undefined);
      const temporary = sessionCreated || (error instanceof Error && ["configuration", "reservation"].includes(error.message));
      return response(temporary ? CHECKOUT_ERROR.TEMPORARILY_UNAVAILABLE : CHECKOUT_ERROR.PROVIDER_FAILURE, temporary ? 503 : 502);
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
        async reserve(profileId, plan) { const { data, error } = await db.rpc("acquire_checkout_capacity_reservation", { p_profile_id: profileId, p_tier: plan }); if (error || !data?.[0]) { const e:any = new Error("reservation"); const message=String(error?.message||""); e.code = message.includes("sold_out") ? "SOLD_OUT" : message.includes("existing_entitlement") ? "EXISTING_ENTITLEMENT" : message.includes("reservation_conflict") ? "RESERVATION_CONFLICT" : "UNAVAILABLE"; throw e; } return data[0]; },
        async release(profileId, plan, id) { const { error } = await db.rpc("release_checkout_capacity_reservation", { p_reservation_id: id, p_profile_id: profileId, p_tier: plan }); if (error) throw error; },
        async associate(profileId, plan, id, sessionId) { const { error } = await db.rpc("associate_checkout_capacity_session", { p_reservation_id:id,p_profile_id:profileId,p_tier:plan,p_stripe_session_id:sessionId }); if (error) throw error; },
        async referral(code) {
          if (!code) return { code:null,affiliateUserId:null,commissionPercent:0,destination:null,connectOnboarded:false,payable:false };
          const { data: referral, error } = await db.from("referral_codes").select("*").eq("code",code).maybeSingle();
          if (error) throw new Error("referral_unavailable");
          if (!referral) return { code:null,affiliateUserId:null,commissionPercent:0,destination:null,connectOnboarded:false,payable:false };
          const affiliateUserId = referral.affiliate_user_id || referral.affiliate_id || referral.user_id || referral.owner_user_id || null;
          const commissionPercent = clampCommissionPercent(referral.commission_percent ?? referral.commissionPercent ?? referral.percent ?? referral.commission_rate);
          if (!affiliateUserId) return { code,affiliateUserId:null,commissionPercent,destination:null,connectOnboarded:false,payable:false };
          const { data: affiliate, error: affiliateError } = await db.from("profiles").select("stripe_connect_account_id,stripe_connect_onboarded").eq("id",affiliateUserId).maybeSingle();
          if (affiliateError) throw new Error("referral_unavailable");
          if (!affiliate) return { code,affiliateUserId,commissionPercent,destination:null,connectOnboarded:false,payable:false };
          const destination = typeof affiliate.stripe_connect_account_id === "string" && affiliate.stripe_connect_account_id.trim() ? affiliate.stripe_connect_account_id.trim() : null;
          const connectOnboarded = affiliate.stripe_connect_onboarded === true;
          return { code,affiliateUserId,commissionPercent,destination:connectOnboarded ? destination:null,connectOnboarded,payable:connectOnboarded && Boolean(destination) };
        },
      };
    },
    configuration(plan, req) { const priceId = process.env[LAUNCH_PLAN_POLICY[plan].priceEnvironment] || ""; const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL; return { priceId, baseUrl: (configured || new URL(req.url).origin).replace(/\/$/,"") }; },
    async customer(profile,user) { return ensureStripeCustomer({ id:profile.id,userId:user.id,email:user.email||profile.email,stripeCustomerId:profile.stripe_customer_id }, createProductionCustomerBoundary()); },
    async retrievePrice(priceId) { const secret=process.env.STRIPE_SECRET_KEY; if(!secret) throw new Error("unavailable"); const price=await new Stripe(secret,{apiVersion:"2025-11-17.clover"}).prices.retrieve(priceId); return {unitAmount:price.unit_amount}; },
    async createSession(input,key) { const secret=process.env.STRIPE_SECRET_KEY; if(!secret) throw new Error("unavailable"); return new Stripe(secret,{apiVersion:"2025-11-17.clover"}).checkout.sessions.create(input,{idempotencyKey:key}); },
  };
}
export async function POST(req: Request) { return createCheckoutHandler(productionDependencies())(req); }

type CancellationReservation = { reservation_id: string; status: string; stripe_session_id: string | null };
type CancellationSession = { status: string | null; paymentStatus: string | null };
export type CancellationDependencies = {
  authenticate(): Promise<User | null>;
  privileged(): Promise<{
    profiles(userId: string): Promise<Profile[]>;
    reservations(profileId: string, plan: PurchasablePlan, reservationId: string): Promise<CancellationReservation[]>;
    release(profileId: string, plan: PurchasablePlan, reservationId: string): Promise<void>;
  }>;
  retrieveSession(sessionId: string): Promise<CancellationSession>;
  expireSession(sessionId: string): Promise<CancellationSession>;
};

export function createCancellationHandler(deps: CancellationDependencies) {
  return async (req: Request) => {
    const user = await deps.authenticate().catch(() => null);
    if (!user) return response(CHECKOUT_ERROR.UNAUTHENTICATED, 401);
    const body = await req.json().catch(() => ({}));
    if (!isPurchasablePlan(body.tier) || typeof body.reservation !== "string" || !body.reservation) return response(CHECKOUT_ERROR.PLAN_UNAVAILABLE, 400);
    try {
      const db = await deps.privileged();
      const profiles = await db.profiles(user.id);
      if (profiles.length !== 1 || profiles[0].user_id !== user.id || !profiles[0].id) return response(CHECKOUT_ERROR.PROFILE_UNAVAILABLE, 403);
      const profile = profiles[0];
      const reservations = await db.reservations(profile.id, body.tier, body.reservation);
      if (reservations.length !== 1 || reservations[0].reservation_id !== body.reservation) return response(CHECKOUT_ERROR.TEMPORARILY_UNAVAILABLE, 503);
      const reservation = reservations[0];
      if (reservation.status === "released") return NextResponse.json({ released: true });
      if (!reservation.stripe_session_id) {
        await db.release(profile.id, body.tier, body.reservation);
        return NextResponse.json({ released: true });
      }
      const session = await deps.retrieveSession(reservation.stripe_session_id);
      if (session.status === "complete" || ["paid", "no_payment_required"].includes(session.paymentStatus || "")) {
        return NextResponse.json({ released: false, processing: true, code: "PAYMENT_PROCESSING" }, { status: 202 });
      }
      if (session.status === "open") {
        const expired = await deps.expireSession(reservation.stripe_session_id);
        if (expired.status !== "expired") return response(CHECKOUT_ERROR.TEMPORARILY_UNAVAILABLE, 503);
      } else if (session.status !== "expired") {
        return response(CHECKOUT_ERROR.TEMPORARILY_UNAVAILABLE, 503);
      }
      await db.release(profile.id, body.tier, body.reservation);
      return NextResponse.json({ released: true });
    } catch {
      return response(CHECKOUT_ERROR.TEMPORARILY_UNAVAILABLE, 503);
    }
  };
}

function productionCancellationDependencies(): CancellationDependencies {
  return {
    async authenticate() { const auth = await supabaseServer(); const { data, error } = await auth.auth.getUser(); return error ? null : data.user; },
    async privileged() {
      const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new Error("unavailable");
      const db = createClient(url, key);
      return {
        async profiles(userId) { const { data, error } = await db.from("profiles").select("id,user_id").eq("user_id", userId).limit(2); if (error) throw error; return data || []; },
        async reservations(profileId, plan, reservationId) {
          const { data, error } = await db.from("checkout_capacity_reservations").select("id,status,stripe_session_id")
            .eq("id", reservationId).eq("profile_id", profileId).eq("tier", plan).limit(2);
          if (error) throw error;
          return (data || []).map((row) => ({ reservation_id: row.id, status: row.status, stripe_session_id: row.stripe_session_id }));
        },
        async release(profileId, plan, reservationId) { const { error } = await db.rpc("release_checkout_capacity_reservation", { p_reservation_id: reservationId, p_profile_id: profileId, p_tier: plan }); if (error) throw error; },
      };
    },
    async retrieveSession(sessionId) { const secret = process.env.STRIPE_SECRET_KEY; if (!secret) throw new Error("unavailable"); const session = await new Stripe(secret, { apiVersion: "2025-11-17.clover" }).checkout.sessions.retrieve(sessionId); return { status: session.status, paymentStatus: session.payment_status }; },
    async expireSession(sessionId) { const secret = process.env.STRIPE_SECRET_KEY; if (!secret) throw new Error("unavailable"); const session = await new Stripe(secret, { apiVersion: "2025-11-17.clover" }).checkout.sessions.expire(sessionId); return { status: session.status, paymentStatus: session.payment_status }; },
  };
}

export async function DELETE(req: Request) { return createCancellationHandler(productionCancellationDependencies())(req); }
