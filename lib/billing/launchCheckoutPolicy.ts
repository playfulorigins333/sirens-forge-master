export const PURCHASABLE_PLANS = ["og_throne", "early_bird"] as const;
export type PurchasablePlan = (typeof PURCHASABLE_PLANS)[number];
export type CheckoutMode = "payment" | "subscription";
export const LAUNCH_CHECKOUT_CONTRACT = "sirens_forge_launch_checkout_v1";
export const OG_BNPL_METHOD_ALLOWLIST = ["affirm", "afterpay_clearpay", "klarna"] as const;
export type LaunchPaymentMethod = "card" | (typeof OG_BNPL_METHOD_ALLOWLIST)[number];
const MAX_BNPL_CONFIGURATION_LENGTH = 256;

export function configuredOgPaymentMethods(raw: unknown): LaunchPaymentMethod[] {
  if (typeof raw !== "string" || raw.length > MAX_BNPL_CONFIGURATION_LENGTH) return ["card"];
  const configured = new Set(raw.split(",").map((value) => value.trim().toLowerCase()));
  return ["card", ...OG_BNPL_METHOD_ALLOWLIST.filter((method) => configured.has(method))];
}

export function paymentMethodTypesForLaunchPlan(plan: PurchasablePlan, rawOgBnplConfig: unknown): LaunchPaymentMethod[] {
  return plan === "og_throne" ? configuredOgPaymentMethods(rawOgBnplConfig) : ["card"];
}

export const LAUNCH_PLAN_POLICY: Record<PurchasablePlan, { mode: CheckoutMode; priceEnvironment: string }> = {
  og_throne: { mode: "payment", priceEnvironment: "STRIPE_PRICE_OG_THRONE" },
  early_bird: { mode: "subscription", priceEnvironment: "STRIPE_PRICE_EARLY_BIRD" },
};

export const CHECKOUT_ERROR = {
  UNAUTHENTICATED: "UNAUTHENTICATED", PROFILE_UNAVAILABLE: "PROFILE_UNAVAILABLE",
  EXISTING_ENTITLEMENT: "EXISTING_ENTITLEMENT", PLAN_UNAVAILABLE: "PLAN_UNAVAILABLE",
  SOLD_OUT: "SOLD_OUT", TEMPORARILY_UNAVAILABLE: "TEMPORARILY_UNAVAILABLE",
  PROVIDER_FAILURE: "PROVIDER_FAILURE", RATE_LIMITED: "RATE_LIMITED",
  CHECKOUT_INACTIVE:"CHECKOUT_INACTIVE", CHECKOUT_CONFIGURATION_FAILURE:"CHECKOUT_CONFIGURATION_FAILURE",
  CHECKOUT_RESERVATION_FAILURE:"CHECKOUT_RESERVATION_FAILURE", CHECKOUT_DATABASE_FAILURE:"CHECKOUT_DATABASE_FAILURE",
  CHECKOUT_PROVIDER_FAILURE:"CHECKOUT_PROVIDER_FAILURE",
  PLAN_SWITCH_UNAVAILABLE:"PLAN_SWITCH_UNAVAILABLE",
} as const;

export function isPurchasablePlan(value: unknown): value is PurchasablePlan {
  return typeof value === "string" && PURCHASABLE_PLANS.includes(value as PurchasablePlan);
}
export function blocksLaunchCheckout(rows: unknown): boolean {
  if (!Array.isArray(rows)) return true;
  return rows.some((row) => row && typeof row === "object" && ["active", "trialing"].includes(String((row as any).status).toLowerCase()));
}
export const checkoutSessionIdempotencyKey = (reservationId: string) => `launch-checkout:${reservationId}`;
export const stripeCustomerIdempotencyKey = (profileId: string) => `launch-customer:${profileId}`;
