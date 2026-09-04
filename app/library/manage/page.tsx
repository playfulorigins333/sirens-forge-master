import { redirect } from "next/navigation";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { policyConsentPath } from "@/lib/material-policy/redirect";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isPrivateCreatorMediaEnabled } from "@/lib/private-creator-media/core";
import ManagePrivateMediaClient from "./ManagePrivateMediaClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manage private media — Sirens Forge" };

type ManagedRow = {
  id: string;
  kind: "image" | "video";
  created_at: string;
  generations: { prompt: string | null } | { prompt: string | null }[];
};

export default async function ManagePrivateMediaPage() {
  const auth = await ensureActiveSubscription();
  if (!auth.ok) {
    if (auth.error === "UNAUTHENTICATED") redirect("/login");
    if (auth.error === "POLICY_ACCEPTANCE_REQUIRED") redirect(policyConsentPath("/library/manage"));
    redirect("/pricing");
  }
  if (!auth.user?.id || !isPrivateCreatorMediaEnabled()) return <ManagePrivateMediaClient items={[]} />;

  const { data, error } = await getSupabaseAdmin()
    .from("generation_assets")
    .select("id,kind,created_at,generations!inner(prompt)")
    .eq("owner_id", auth.user.id)
    .eq("lifecycle_state", "active")
    .order("created_at", { ascending: false });

  if (error) throw new Error("Private media management could not be loaded.");

  const items = ((data ?? []) as unknown as ManagedRow[]).map((row) => {
    const generation = Array.isArray(row.generations) ? row.generations[0] : row.generations;
    return { id: row.id, kind: row.kind, prompt: generation?.prompt || "", createdAt: row.created_at };
  });

  return <ManagePrivateMediaClient items={items} />;
}
