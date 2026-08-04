import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calculatePaymentV2Inventory, PAYMENT_V2_PUBLIC_CAPACITY } from "@/lib/payment-v2/inventory";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const unavailable = () => NextResponse.json({ success: false, error: "inventory_unavailable" }, { status: 500, headers: noStore });

export async function GET() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return unavailable();
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const tiersQuery = await supabase.from("subscription_tiers").select("name,is_active,stripe_price_id").in("name", ["og_throne", "early_bird"]);
    if (tiersQuery.error || !Array.isArray(tiersQuery.data)) return unavailable();
    const configured = Object.fromEntries((["og_throne", "early_bird"] as const).map((name) => {
      const matches = tiersQuery.data.filter((row) => row.name === name);
      if (matches.length !== 1 || typeof matches[0].is_active !== "boolean" ||
          (matches[0].is_active && (typeof matches[0].stripe_price_id !== "string" || !matches[0].stripe_price_id.trim())))
        throw new Error("inventory_unavailable");
      return [name, matches[0]];
    }));
    const holdsQuery = await supabase.from("payment_v2_holds").select("tier,state,expires_at");
    if (holdsQuery.error || !Array.isArray(holdsQuery.data)) return unavailable();
    const inventory = calculatePaymentV2Inventory(holdsQuery.data, new Date());
    return NextResponse.json({ success: true, tiers: {
      og_throne: { ...inventory.og_throne, max_slots: PAYMENT_V2_PUBLIC_CAPACITY.og_throne, is_active: configured.og_throne.is_active },
      early_bird: { ...inventory.early_bird, max_slots: PAYMENT_V2_PUBLIC_CAPACITY.early_bird, is_active: configured.early_bird.is_active },
    } }, { headers: noStore });
  } catch {
    return unavailable();
  }
}
