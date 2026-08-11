import { supabaseServer } from "@/lib/supabaseServer";

export type BillingCustomerResolution =
  | { ok: true; customerId: string }
  | { ok: false; code: "BILLING_CUSTOMER_NOT_FOUND" | "BILLING_CUSTOMER_AMBIGUOUS" };

export function resolveCollectedBillingCustomerIds(values: unknown[]): BillingCustomerResolution {
  const customerIds = new Set(
    values.flatMap((value) => typeof value === "string" && value.trim() ? [value.trim()] : [])
  );
  if (customerIds.size === 0) return { ok: false, code: "BILLING_CUSTOMER_NOT_FOUND" };
  if (customerIds.size > 1) return { ok: false, code: "BILLING_CUSTOMER_AMBIGUOUS" };
  return { ok: true, customerId: [...customerIds][0] };
}

export async function resolveExistingBillingCustomer(profileId: string): Promise<BillingCustomerResolution> {
  const supabase = await supabaseServer();
  const [profileResult, subscriptionResult, purchaseResult] = await Promise.all([
    supabase.from("profiles").select("stripe_customer_id").eq("id", profileId).maybeSingle(),
    supabase.from("user_subscriptions").select("stripe_customer_id").eq("user_id", profileId),
    supabase.from("payment_v2_purchases").select("stripe_customer_id").eq("claimed_profile_id", profileId),
  ]);

  const lookupError = profileResult.error || subscriptionResult.error || purchaseResult.error;
  if (lookupError) throw new Error(`BILLING_CUSTOMER_LOOKUP_FAILED: ${lookupError.message}`);

  return resolveCollectedBillingCustomerIds([
    profileResult.data?.stripe_customer_id,
    ...(subscriptionResult.data ?? []).map((row) => row.stripe_customer_id),
    ...(purchaseResult.data ?? []).map((row) => row.stripe_customer_id),
  ]);
}
