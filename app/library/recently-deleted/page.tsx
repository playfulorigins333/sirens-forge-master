import { redirect } from "next/navigation";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { policyConsentPath } from "@/lib/material-policy/redirect";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isPrivateCreatorMediaEnabled } from "@/lib/private-creator-media/core";
import RecentlyDeletedClient from "./RecentlyDeletedClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recently Deleted — Sirens Forge" };

type DeletedRow = {
  id: string;
  generation_id: string;
  kind: "image" | "video";
  lifecycle_state: "trashed" | "purge_pending";
  trashed_at: string | null;
  purge_after: string | null;
  generations: { prompt: string | null } | { prompt: string | null }[];
};

export default async function RecentlyDeletedPage() {
  const auth = await ensureActiveSubscription();
  if (!auth.ok) {
    if (auth.error === "UNAUTHENTICATED") redirect("/login");
    if (auth.error === "POLICY_ACCEPTANCE_REQUIRED") redirect(policyConsentPath("/library/recently-deleted"));
    redirect("/pricing");
  }
  if (!auth.user?.id || !isPrivateCreatorMediaEnabled()) return <RecentlyDeletedClient items={[]} />;

  const { data, error } = await getSupabaseAdmin()
    .from("generation_assets")
    .select("id,generation_id,kind,lifecycle_state,trashed_at,purge_after,generations!inner(prompt)")
    .eq("owner_id", auth.user.id)
    .in("lifecycle_state", ["trashed", "purge_pending"])
    .order("trashed_at", { ascending: false });

  if (error) throw new Error("Recently Deleted could not be loaded.");

  const items = ((data ?? []) as unknown as DeletedRow[]).map((row) => {
    const generation = Array.isArray(row.generations) ? row.generations[0] : row.generations;
    return {
      id: row.id,
      generationId: row.generation_id,
      kind: row.kind,
      prompt: generation?.prompt || "",
      lifecycleState: row.lifecycle_state,
      trashedAt: row.trashed_at,
      purgeAfter: row.purge_after,
    };
  });

  return <RecentlyDeletedClient items={items} />;
}
