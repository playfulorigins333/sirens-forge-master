// app/library/page.tsx
import { redirect } from "next/navigation";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { supabaseServer } from "@/lib/supabaseServer";
import LibraryClient, { LibraryItem } from "./LibraryClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sirens Forge — Vault",
};

function inferKind(row: any): "image" | "video" {
  const imageUrl = String(row?.image_url || "").toLowerCase();
  const metadata = row?.metadata || {};
  const outputUrl = String(
    metadata?.video_url ||
      metadata?.output_url ||
      metadata?.placeholder_url ||
      ""
  ).toLowerCase();

  if (
    imageUrl.endsWith(".mp4") ||
    imageUrl.endsWith(".webm") ||
    outputUrl.endsWith(".mp4") ||
    outputUrl.endsWith(".webm") ||
    String(metadata?.mode || "").includes("video")
  ) {
    return "video";
  }

  return "image";
}

function inferUrl(row: any): string {
  const metadata = row?.metadata || {};

  return (
    row?.image_url ||
    metadata?.video_url ||
    metadata?.output_url ||
    metadata?.placeholder_url ||
    ""
  );
}

function inferBodyMode(row: any): string | null {
  return (
    row?.body_type ||
    row?.metadata?.body_mode ||
    row?.metadata?.request?.body_mode ||
    null
  );
}

function inferIdentityLora(row: any): string | null {
  return row?.metadata?.identity_lora || null;
}

function inferGenerationMode(row: any): string | null {
  return row?.job_type || row?.metadata?.mode || null;
}

export default async function LibraryPage() {
  const auth = await ensureActiveSubscription();

  if (!auth.ok) {
    if (auth.error === "UNAUTHENTICATED") {
      redirect("/login");
    } else {
      redirect("/pricing");
    }
  }

  const profileId = auth.profile?.id;
  if (!profileId) {
    redirect("/pricing");
  }

  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("generations")
    .select(
      `
      id,
      user_id,
      prompt,
      image_url,
      created_at,
      updated_at,
      status,
      job_type,
      body_type,
      metadata
    `
    )
    .eq("user_id", profileId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[library] Failed to load generations:", error);
  }

  const items: LibraryItem[] = (data || [])
    .map((row: any) => {
      const url = inferUrl(row);

      return {
        id: row.id,
        kind: inferKind(row),
        url,
        prompt: row.prompt || "",
        createdAt: row.created_at || row.updated_at || new Date().toISOString(),
        status: row.status || "unknown",
        mode: inferGenerationMode(row),
        bodyMode: inferBodyMode(row),
        identityLora: inferIdentityLora(row),
      };
    })
    .filter((item) => Boolean(item.url));

  return <LibraryClient items={items} />;
}