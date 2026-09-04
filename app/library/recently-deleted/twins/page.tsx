import { redirect } from "next/navigation";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { policyConsentPath } from "@/lib/material-policy/redirect";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import RecentlyDeletedTwinsClient from "./RecentlyDeletedTwinsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recently Deleted AI Twins — Sirens Forge" };

type TwinRow = {
  id: string;
  name: string | null;
  status: string | null;
  lifecycle_state: "trashed" | "purge_pending";
  trashed_at: string | null;
  purge_after: string | null;
  training_data_state: "active" | "purge_pending" | "purged";
};

export default async function RecentlyDeletedTwinsPage() {
  const auth = await ensureActiveSubscription();
  if (!auth.ok) {
    if (auth.error === "UNAUTHENTICATED") redirect("/login");
    if (auth.error === "POLICY_ACCEPTANCE_REQUIRED") redirect(policyConsentPath("/library/recently-deleted/twins"));
    redirect("/pricing");
  }
  const userId = auth.user?.id;
  if (!userId) redirect("/pricing");
  const { data, error } = await getSupabaseAdmin()
    .from("user_loras")
    .select("id,name,status,lifecycle_state,trashed_at,purge_after,training_data_state")
    .eq("user_id", userId)
    .in("lifecycle_state", ["trashed", "purge_pending"])
    .order("trashed_at", { ascending: false });
  if (error) throw new Error("Recently Deleted AI Twins could not be loaded.");
  const items = ((data ?? []) as TwinRow[]).map((row) => ({
    id: row.id,
    name: row.name?.trim() || "Unnamed AI Twin",
    status: row.status || "unknown",
    lifecycleState: row.lifecycle_state,
    trainingDataState: row.training_data_state,
    trashedAt: row.trashed_at,
    purgeAfter: row.purge_after,
  }));
  return <RecentlyDeletedTwinsClient items={items} />;
}
