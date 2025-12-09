import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("subscription_tiers")
      .select("name, max_slots, slots_remaining, is_active");

    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Build readable response object
    const formatted: Record<string, any> = {};

    data?.forEach((tier) => {
      formatted[tier.name] = {
        max: tier.max_slots ?? null,
        remaining: tier.slots_remaining ?? null,
        active: tier.is_active ?? false,
      };
    });

    return NextResponse.json({
      success: true,
      tiers: formatted,
    });

  } catch (err: any) {
    console.error("Seat count route error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
