import { supabaseServer } from "@/lib/supabaseServer";
import { requireOptInMfaSatisfied } from "@/lib/security/mfa";

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
        account_lifecycle_state: string;
        account_lifecycle_updated_at: string | null;
      };
      status: 200;
    }
  | {
      ok: false;
      error: "UNAUTHENTICATED" | "MFA_ENROLLMENT_REQUIRED" | "MFA_CHALLENGE_REQUIRED" | "MFA_FRESH_AUTH_REQUIRED" | "MFA_LOOKUP_FAILED" | "PROFILE_LOOKUP_FAILED" | "NO_PROFILE" | "INTERNAL_ERROR";
      message: string;
      status: 401 | 403 | 428 | 500 | 503;
    };

export async function ensureAuthenticatedProfile(): Promise<AccountAccessResult> {
  try {
    const supabase = await supabaseServer();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return { ok: false, error: "UNAUTHENTICATED", message: "You must be logged in to access this area.", status: 401 };
    }
    const mfa = await requireOptInMfaSatisfied(supabase);
    if (mfa.ok === false) return { ok: false, error: mfa.error, message: "Multi-factor authentication is required.", status: mfa.status };

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, user_id, email, badge, seat_number, stripe_customer_id, account_lifecycle_state, account_lifecycle_updated_at")
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
        account_lifecycle_state: profile.account_lifecycle_state ?? "active",
        account_lifecycle_updated_at: profile.account_lifecycle_updated_at ?? null,
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
