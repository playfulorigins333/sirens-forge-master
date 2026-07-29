import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { stripeCustomerIdempotencyKey } from "@/lib/billing/launchCheckoutPolicy";

export type CustomerProfile = { id: string; userId: string; email?: string | null; stripeCustomerId?: string | null };
export type CustomerBoundaries = {
  createCustomer(input: { email?: string; metadata: Record<string, string> }, idempotencyKey: string): Promise<{ id: string }>;
  assignIfEmpty(profileId: string, userId: string, customerId: string): Promise<boolean>;
  readCustomer(profileId: string, userId: string): Promise<string | null>;
};

export async function ensureStripeCustomer(profile: CustomerProfile, boundary: CustomerBoundaries): Promise<string> {
  if (!profile.id || !profile.userId) throw new Error("customer_unavailable");
  if (profile.stripeCustomerId) return profile.stripeCustomerId;
  const customer = await boundary.createCustomer({
    ...(profile.email ? { email: profile.email } : {}),
    metadata: { user_id: profile.userId, profile_id: profile.id },
  }, stripeCustomerIdempotencyKey(profile.id));
  if (await boundary.assignIfEmpty(profile.id, profile.userId, customer.id)) return customer.id;
  const winner = await boundary.readCustomer(profile.id, profile.userId);
  if (winner) return winner;
  throw new Error("customer_unavailable");
}

export function createProductionCustomerBoundary(): CustomerBoundaries {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!url || !key || !stripeKey) throw new Error("customer_unavailable");
  const db = createClient(url, key);
  const stripe = new Stripe(stripeKey, { apiVersion: "2025-11-17.clover" });
  return {
    async createCustomer(input, idempotencyKey) { return stripe.customers.create(input, { idempotencyKey }); },
    async assignIfEmpty(profileId, userId, customerId) {
      const { data, error } = await db.from("profiles").update({ stripe_customer_id: customerId })
        .eq("id", profileId).eq("user_id", userId).is("stripe_customer_id", null).select("id");
      if (error) throw new Error("customer_unavailable");
      return Array.isArray(data) && data.length === 1;
    },
    async readCustomer(profileId, userId) {
      const { data, error } = await db.from("profiles").select("stripe_customer_id")
        .eq("id", profileId).eq("user_id", userId).maybeSingle();
      if (error) throw new Error("customer_unavailable");
      return data?.stripe_customer_id || null;
    },
  };
}

// Compatibility for existing authenticated billing callers. Construction remains lazy.
type CompatibilityDependencies = {
  resolveProfile(profileId: string): Promise<{ id: string; userId: string; email?: string | null; stripeCustomerId?: string | null }>;
  customerBoundary: CustomerBoundaries;
};

function createCompatibilityDependencies(): CompatibilityDependencies {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("customer_unavailable");
  const db = createClient(url, key);
  return {
    customerBoundary: createProductionCustomerBoundary(),
    async resolveProfile(profileId) {
      const { data, error } = await db.from("profiles").select("id,user_id,email,stripe_customer_id").eq("id", profileId).maybeSingle();
      if (error || !data?.id || !data?.user_id) throw new Error("customer_unavailable");
      return { id:data.id,userId:data.user_id,email:data.email,stripeCustomerId:data.stripe_customer_id };
    },
  };
}

export async function getOrCreateStripeCustomer(profileId: string, email?: string, injected?: CompatibilityDependencies) {
  try {
    const dependencies = injected || createCompatibilityDependencies();
    const profile = await dependencies.resolveProfile(profileId);
    if (profile.id !== profileId) throw new Error("customer_unavailable");
    return await ensureStripeCustomer({ ...profile, email: email || profile.email }, dependencies.customerBoundary);
  } catch {
    throw new Error("customer_unavailable");
  }
}
