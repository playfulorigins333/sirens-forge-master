import { cookies } from "next/headers";
import { createServerClient } from "@supabase/auth-helpers-nextjs";

export type SubscriptionTier =
  | "OG_FOUNDER"
  | "EARLY_BIRD"
  | "PRIME_ACCESS"
  | "STARTER_HIT"
  | "NONE";

export interface UserSubscription {
  tier: SubscriptionTier;
  isActive: boolean;
  expiresAt: string | null;
  seatNumber?: number | null;
}

export async function getUserSubscription(): Promise<UserSubscription> {
  const cookieStore = await cookies(); // ← FIXED

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {},
        remove() {},
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      tier: "NONE",
      isActive: false,
      expiresAt: null,
    };
  }

  const { data, error } = await supabase
    .from("user_subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) {
    return {
      tier: "NONE",
      isActive: false,
      expiresAt: null,
    };
  }

  const isExpired =
    data.expires_at && new Date(data.expires_at).getTime() < Date.now();

  return {
    tier: (data.tier as SubscriptionTier) || "NONE",
    isActive: !isExpired,
    expiresAt: data.expires_at,
    seatNumber: data.seat_number ?? null,
  };
}
