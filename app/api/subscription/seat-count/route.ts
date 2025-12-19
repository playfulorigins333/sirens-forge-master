import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const ACTIVE_STATUSES = ["active", "trialing"] as const;

// Launch tiers only (explicit allow-list)
// NOTE: We intentionally exclude starter_hit for launch.
const LAUNCH_TIERS = ["og_throne", "early_bird", "prime_access"] as const;
type LaunchTierName = (typeof LAUNCH_TIERS)[number];

type TierRow = {
  id: string;
  name: string;
  max_slots: number | null;
  slots_remaining: number | null;
  is_active: boolean | null;
};

function clampNonNegative(n: number) {
  return n < 0 ? 0 : n;
}

export async function GET() {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { success: false, error: "server_not_configured" },
        { status: 500 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1) Pull tiers from subscription_tiers (authoritative)
    const { data: tiersRaw, error: tiersErr } = await supabase
      .from("subscription_tiers")
      .select("id,name,max_slots,slots_remaining,is_active");

    if (tiersErr) {
      console.error("Seat count: tiers query error:", tiersErr);
      return NextResponse.json(
        { success: false, error: "tiers_query_failed" },
        { status: 500 }
      );
    }

    const tiers = (tiersRaw || [])
      .filter((t: TierRow) => LAUNCH_TIERS.includes(t.name as LaunchTierName))
      .reduce<Record<string, TierRow>>((acc, t: TierRow) => {
        acc[t.name] = t;
        return acc;
      }, {});

    // 2) Count active subscriptions for each tier (derived)
    // We do separate counting so we can exclude OG testers (counts_toward_seats=false).
    const counts: Record<LaunchTierName, number> = {
      og_throne: 0,
      early_bird: 0,
      prime_access: 0,
    };

    // Early Bird count
    {
      const { count, error } = await supabase
        .from("user_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("tier_name", "early_bird")
        .in("status", [...ACTIVE_STATUSES]);

      if (error) {
        console.error("Seat count: early_bird count error:", error);
        return NextResponse.json(
          { success: false, error: "count_failed_early_bird" },
          { status: 500 }
        );
      }
      counts.early_bird = count ?? 0;
    }

    // Prime count
    {
      const { count, error } = await supabase
        .from("user_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("tier_name", "prime_access")
        .in("status", [...ACTIVE_STATUSES]);

      if (error) {
        console.error("Seat count: prime_access count error:", error);
        return NextResponse.json(
          { success: false, error: "count_failed_prime_access" },
          { status: 500 }
        );
      }
      counts.prime_access = count ?? 0;
    }

    // OG count (exclude testers where metadata->>counts_toward_seats = 'false')
    {
      const { count: totalOg, error: totalErr } = await supabase
        .from("user_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("tier_name", "og_throne")
        .in("status", [...ACTIVE_STATUSES]);

      if (totalErr) {
        console.error("Seat count: og total count error:", totalErr);
        return NextResponse.json(
          { success: false, error: "count_failed_og_total" },
          { status: 500 }
        );
      }

      // Count excluded (tester grants, etc.)
      // PostgREST supports json path filters like: metadata->>key
      const { count: excludedOg, error: excludedErr } = await supabase
        .from("user_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("tier_name", "og_throne")
        .in("status", [...ACTIVE_STATUSES])
        .filter("metadata->>counts_toward_seats", "eq", "false");

      if (excludedErr) {
        console.error("Seat count: og excluded count error:", excludedErr);
        return NextResponse.json(
          { success: false, error: "count_failed_og_excluded" },
          { status: 500 }
        );
      }

      const paidOg = (totalOg ?? 0) - (excludedOg ?? 0);
      counts.og_throne = paidOg < 0 ? 0 : paidOg;
    }

    // 3) Build response in the format PricingPage expects
    // PricingPage currently reads: tiers.og_throne, tiers.early_bird, tiers.prime_access
    const responseTiers: Record<string, any> = {};

    for (const name of LAUNCH_TIERS) {
      const tier = tiers[name];
      const max = tier?.max_slots ?? null;

      // If max_slots is null, keep remaining null (unlimited / not capped)
      const remaining =
        typeof max === "number" ? clampNonNegative(max - (counts[name] ?? 0)) : null;

      responseTiers[name] = {
        max_slots: max,
        slots_remaining: remaining,
        is_active: tier?.is_active ?? false,
      };
    }

    return NextResponse.json({
      success: true,
      tiers: responseTiers,
    });
  } catch (err: any) {
    console.error("Seat count route fatal error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "internal_error" },
      { status: 500 }
    );
  }
}
