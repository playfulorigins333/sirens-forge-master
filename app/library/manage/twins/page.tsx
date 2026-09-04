import { redirect } from "next/navigation";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { policyConsentPath } from "@/lib/material-policy/redirect";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import ManageTwinsClient from "./ManageTwinsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manage AI Twins — Sirens Forge" };

type TwinRow = {
  id: string;
  name: string | null;
  status: string | null;
  training_data_state: "active" | "purge_pending" | "purged";
  created_at: string | null;
  artifact_r2_key: string | null;
  dataset_r2_prefix: string | null;
};

export default async function ManageTwinsPage() {
  const auth = await ensureActiveSubscription();
  if (!auth.ok) {
    if (auth.error === "UNAUTHENTICATED") redirect("/login");
    if (auth.error === "POLICY_ACCEPTANCE_REQUIRED") redirect(policyConsentPath("/library/manage/twins"));
    redirect("/pricing");
  }
  const userId = auth.user?.id;
  if (!userId) redirect("/pricing");

  const { data, error } = await getSupabaseAdmin()
    .from("user_loras")
    .select("id,name,status,training_data_state,created_at,artifact_r2_key,dataset_r2_prefix")
    .eq("user_id", userId)
    .eq("lifecycle_state", "active")
    .order("created_at", { ascending: false });
  if (error) throw new Error("AI Twin management could not be loaded.");

  const items = ((data ?? []) as TwinRow[]).map((row) => ({
    id: row.id,
    name: row.name?.trim() || "Unnamed AI Twin",
    status: row.status || "unknown",
    trainingDataState: row.training_data_state,
    createdAt: row.created_at,
    hasArtifact: Boolean(row.artifact_r2_key?.trim()),
    hasTrainingData: row.training_data_state !== "purged" && Boolean(row.dataset_r2_prefix?.trim()),
  }));
  return <ManageTwinsClient items={items} />;
}
