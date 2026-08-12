import { LAUNCH_CAPACITY } from "@/lib/launch-capacity";

export const PAYMENT_V2_PUBLIC_CAPACITY = {
  og_throne: LAUNCH_CAPACITY.og_throne,
  early_bird: LAUNCH_CAPACITY.early_bird,
} as const;
export type PaymentV2InventoryTier = keyof typeof PAYMENT_V2_PUBLIC_CAPACITY;
export type PaymentV2InventoryRow = { tier: unknown; state: unknown; expires_at: unknown };

const STATES = new Set(["HELD", "SESSION_ASSOCIATED", "PAID_UNCLAIMED", "CLAIMED", "EXPIRED_UNPAID", "CANCELED_UNPAID", "REFUNDED", "REVOKED"]);
const ALWAYS_COUNTED = new Set(["SESSION_ASSOCIATED", "PAID_UNCLAIMED", "CLAIMED"]);

export function calculatePaymentV2Inventory(rows: PaymentV2InventoryRow[], now: Date) {
  if (!Array.isArray(rows)) throw new Error("inventory_unavailable");
  if (!Number.isFinite(now.getTime())) throw new Error("inventory_unavailable");
  const used: Record<PaymentV2InventoryTier, number> = { og_throne: 0, early_bird: 0 };
  for (const row of rows) {
    if (row.tier !== "og_throne" && row.tier !== "early_bird") throw new Error("inventory_unavailable");
    if (typeof row.state !== "string" || !STATES.has(row.state)) throw new Error("inventory_unavailable");
    let consumes = ALWAYS_COUNTED.has(row.state);
    if (row.state === "HELD") {
      if (typeof row.expires_at !== "string" || !row.expires_at.trim()) throw new Error("inventory_unavailable");
      const expiration = Date.parse(row.expires_at);
      if (!Number.isFinite(expiration)) throw new Error("inventory_unavailable");
      consumes = expiration > now.getTime();
    }
    if (consumes) used[row.tier] += 1;
  }
  if (used.og_throne > PAYMENT_V2_PUBLIC_CAPACITY.og_throne ||
      used.early_bird > PAYMENT_V2_PUBLIC_CAPACITY.early_bird) throw new Error("inventory_unavailable");
  return {
    og_throne: {
      max_slots: PAYMENT_V2_PUBLIC_CAPACITY.og_throne,
      slots_remaining: PAYMENT_V2_PUBLIC_CAPACITY.og_throne - used.og_throne,
    },
    early_bird: {
      max_slots: PAYMENT_V2_PUBLIC_CAPACITY.early_bird,
      slots_remaining: PAYMENT_V2_PUBLIC_CAPACITY.early_bird - used.early_bird,
    },
  };
}
