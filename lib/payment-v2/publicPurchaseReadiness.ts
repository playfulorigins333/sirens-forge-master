import { calculatePaymentV2Inventory, type PaymentV2InventoryRow } from "./inventory";

export const LOCKED_PAYMENT_V2_PRICES = {
  og_throne: "price_1SRzMSFjcWRhhOnzmON74k5O",
  early_bird: "price_1SRxiNFjcWRhhOnzHVXW0cYi",
} as const;

export type PublicCheckoutMode = "payment_v2";
export type PublicTierState = "available" | "unavailable" | "sold_out";
export type PublicPurchaseState = {
  checkoutMode: PublicCheckoutMode;
  tiers?: { og_throne: PublicTierState; early_bird: PublicTierState };
};

type TierRow = { name: unknown; is_active: unknown; stripe_price_id: unknown };
export type PublicReadinessDependencies = {
  loadAffiliateCapability(): Promise<boolean>;
  loadTiers(): Promise<TierRow[]>;
  loadInventoryRows(): Promise<PaymentV2InventoryRow[]>;
  now(): Date;
};

const REQUIRED_TRUE = [
  "PAYMENT_FIRST_PUBLIC_CUTOVER_V2_ENABLED",
  "PAYMENT_FIRST_WEBHOOK_V2_ENABLED",
  "PAYMENT_FIRST_CLAIM_V2_ENABLED",
  "PAYMENT_FIRST_SUCCESS_V2_ENABLED",
  "PAYMENT_FIRST_AUTH_CONTINUATION_V2_ENABLED",
  "PAYMENT_FIRST_CHECKOUT_V2_PROTECTION_ENABLED",
  "PAYMENT_FIRST_CHECKOUT_V2_ENABLED",
  "PAYMENT_V2_EVENT_INBOX_ENABLED",
  "PAYMENT_V2_PAYOUT_EXECUTION_ENABLED",
] as const;

const unavailable = (): PublicPurchaseState => ({ checkoutMode: "payment_v2", tiers: { og_throne: "unavailable", early_bird: "unavailable" } });
const present = (value: string | undefined) => typeof value === "string" && value.trim().length > 0;

function canonicalOrigin(value: string | undefined, production: boolean): string | null {
  if (!value || value.includes(",")) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (production ? url.protocol !== "https:" : url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) return null;
    return url.origin;
  } catch { return null; }
}

function serviceOrigin(value: string | undefined, production: boolean): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash &&
      (production ? url.protocol === "https:" : url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost"));
  } catch { return false; }
}

export function paymentFirstPublicCutoverEnabled(value: string | undefined): boolean {
  return value === "true";
}

export async function derivePublicPurchaseState(
  env: Record<string, string | undefined>,
  dependencies: PublicReadinessDependencies,
): Promise<PublicPurchaseState> {
  if (!paymentFirstPublicCutoverEnabled(env.PAYMENT_FIRST_PUBLIC_CUTOVER_V2_ENABLED)) return unavailable();
  if (REQUIRED_TRUE.some((name) => env[name] !== "true")) return unavailable();
  const production = env.NODE_ENV === "production";
  const site = canonicalOrigin(env.NEXT_PUBLIC_SITE_URL, production);
  const returns = canonicalOrigin(env.PAYMENT_FIRST_CHECKOUT_V2_RETURN_ORIGIN, production);
  const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  if (!site || !returns || site !== returns || !present(env.STRIPE_SECRET_KEY) || !present(env.STRIPE_PAYMENT_V2_WEBHOOK_SECRET) ||
      !serviceOrigin(supabaseUrl, production) || !present(env.SUPABASE_SERVICE_ROLE_KEY) || !present(env.CRON_SECRET)) return unavailable();
  try {
    if (await dependencies.loadAffiliateCapability() !== true) return unavailable();
    const rows = await dependencies.loadTiers();
    for (const name of ["og_throne", "early_bird"] as const) {
      const matches = rows.filter((row) => row.name === name);
      if (matches.length !== 1 || matches[0].is_active !== true || matches[0].stripe_price_id !== LOCKED_PAYMENT_V2_PRICES[name]) return unavailable();
    }
    if (rows.length !== 2) return unavailable();
    const inventory = calculatePaymentV2Inventory(await dependencies.loadInventoryRows(), dependencies.now());
    return { checkoutMode: "payment_v2", tiers: {
      og_throne: inventory.og_throne.slots_remaining === 0 ? "sold_out" : "available",
      early_bird: inventory.early_bird.slots_remaining === 0 ? "sold_out" : "available",
    } };
  } catch { return unavailable(); }
}
