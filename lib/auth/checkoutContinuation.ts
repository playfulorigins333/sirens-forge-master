export const CHECKOUT_TIERS = ["og_throne", "early_bird"] as const;
export type CheckoutTier = (typeof CHECKOUT_TIERS)[number];
export const CHECKOUT_DESTINATION = "/pricing" as const;
export const MAX_REFERRAL_LENGTH = 32;

export type CheckoutContinuation = {
  tier: CheckoutTier;
  referral?: string;
  next: typeof CHECKOUT_DESTINATION;
};

export function parseCheckoutTier(value: unknown): CheckoutTier | null {
  return typeof value === "string" && CHECKOUT_TIERS.includes(value as CheckoutTier)
    ? (value as CheckoutTier)
    : null;
}

export function normalizeReferral(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value)) return null;
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  return normalized.length > 0 && normalized.length <= MAX_REFERRAL_LENGTH && /^[A-Z0-9_-]+$/.test(normalized)
    ? normalized
    : null;
}

function safelyDecode(value: string): string | null {
  try { return decodeURIComponent(value); } catch { return null; }
}

export function parseCheckoutContinuation(value: unknown): CheckoutContinuation | null {
  if (typeof value !== "string" || !value || /[\\#\x00-\x1f\x7f]/.test(value)) return null;
  const decoded = safelyDecode(value);
  if (!decoded || decoded !== value || /[\\#\x00-\x1f\x7f]/.test(decoded)) return null;
  let params: URLSearchParams;
  try { params = new URLSearchParams(value); } catch { return null; }
  const allowed = new Set(["tier", "ref", "next"]);
  for (const key of params.keys()) if (!allowed.has(key)) return null;
  if ([...params.keys()].some((key, i, all) => all.indexOf(key) !== i)) return null;
  const tier = parseCheckoutTier(params.get("tier"));
  if (!tier || params.get("next") !== CHECKOUT_DESTINATION) return null;
  const rawReferral = params.get("ref");
  const referral = normalizeReferral(rawReferral);
  if (rawReferral && !referral) return null;
  return { tier, ...(referral ? { referral } : {}), next: CHECKOUT_DESTINATION };
}

export function serializeCheckoutContinuation(input: { tier: unknown; referral?: unknown }): string | null {
  const tier = parseCheckoutTier(input.tier);
  if (!tier) return null;
  const referral = normalizeReferral(input.referral);
  if (input.referral && !referral) return null;
  return `tier=${tier}${referral ? `&ref=${referral}` : ""}&next=/pricing`;
}

export function checkoutPricingUrl(intent: CheckoutContinuation): string {
  const params = new URLSearchParams({ tier: intent.tier, confirm: "checkout" });
  if (intent.referral) params.set("ref", intent.referral);
  return `${CHECKOUT_DESTINATION}?${params}`;
}
