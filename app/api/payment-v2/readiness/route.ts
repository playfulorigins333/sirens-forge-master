import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { derivePublicPurchaseState } from "@/lib/payment-v2/publicPurchaseReadiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const db = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  const state = await derivePublicPurchaseState(process.env, {
    now: () => new Date(),
    async loadAffiliateCapability() {
      if (!db) throw new Error("unavailable");
      const { data, error } = await db.rpc("payment_v2_affiliate_public_cutover_ready");
      if (error || data !== true) throw new Error("unavailable");
      return true;
    },
    async loadTiers() {
      if (!db) throw new Error("unavailable");
      const { data, error } = await db.from("subscription_tiers").select("name,is_active,stripe_price_id").in("name", ["og_throne", "early_bird"]);
      if (error || !Array.isArray(data)) throw new Error("unavailable");
      return data;
    },
    async loadInventoryRows() {
      if (!db) throw new Error("unavailable");
      const { data, error } = await db.from("payment_v2_holds").select("tier,state,expires_at");
      if (error || !Array.isArray(data)) throw new Error("unavailable");
      return data;
    },
  });
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
}
