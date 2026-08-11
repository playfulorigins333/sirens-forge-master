import { supabaseServer } from "@/lib/supabaseServer";

export type AccountAccessResult =
  | {
      ok: true;
      user: { id: string; email: string | null };
      profile: {
        id: string;
        user_id: string | null;
        email: string | null;
        badge: string | null;
        seat_number: number | null;
        stripe_customer_id: string | null;
      };
      status: 200;
    }
  | {
      ok: false;
      error: "UNAUTHENTICATED" | "PROFILE_LOOKUP_FAILED" | "NO_PROFILE" | "INTERNAL_ERROR";
      message: string;
      status: 401 | 403 | 500;
    };

export async function ensureAuthenticatedProfile(): Promise<AccountAccessResult> {
  try {
    const supabase = await supabaseServer();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return { ok: false, error: "UNAUTHENTICATED", message: "You must be logged in to access this area.", status: 401 };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, user_id, email, badge, seat_number, stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      return { ok: false, error: "PROFILE_LOOKUP_FAILED", message: profileError.message ?? "Failed to load profile.", status: 500 };
    }
    if (!profile) {
      return { ok: false, error: "NO_PROFILE", message: "No profile found for this account.", status: 403 };
    }

    return {
      ok: true,
      user: { id: user.id, email: user.email ?? null },
      profile: {
        id: profile.id,
        user_id: profile.user_id ?? null,
        email: profile.email ?? null,
        badge: profile.badge ?? null,
        seat_number: profile.seat_number ?? null,
        stripe_customer_id: profile.stripe_customer_id ?? null,
      },
      status: 200,
    };
  } catch (error: any) {
    const unauthenticated = error?.message === "Unauthorized" || error?.message === "Auth session missing!";
    return unauthenticated
      ? { ok: false, error: "UNAUTHENTICATED", message: "You must be logged in to access this area.", status: 401 }
      : { ok: false, error: "INTERNAL_ERROR", message: error?.message ?? "Unknown error", status: 500 };
  }
}
