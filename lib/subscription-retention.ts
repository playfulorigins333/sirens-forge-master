import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type SubscriptionRetentionSummary = {
  paidAccessEndedAt: string;
  retentionUntil: string;
  state: string;
};

export async function getSubscriptionRetentionSummary(authUserId: string, profileId: string): Promise<SubscriptionRetentionSummary | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("subscription_cancellation_retentions")
    .select("paid_access_ends_at,retention_until,state")
    .eq("auth_user_id", authUserId)
    .eq("profile_id", profileId)
    .in("state", ["pending_paid_access_end", "retained_read_only", "expired"])
    .order("retention_until", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Cancellation retention status is unavailable.");
  return data ? { paidAccessEndedAt: data.paid_access_ends_at, retentionUntil: data.retention_until, state: data.state } : null;
}
