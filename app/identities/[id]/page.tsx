// app/identities/[id]/page.tsx
import { notFound, redirect } from "next/navigation";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { supabaseServer } from "@/lib/supabaseServer";
import IdentityDetailClient, {
  IdentityDetailAsset,
  IdentityDetailData,
} from "./IdentityDetailClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

function inferAssetUrl(row: any): string | null {
  const metadata = row?.metadata || {};
  return (
    row?.image_url ||
    metadata?.video_url ||
    metadata?.output_url ||
    metadata?.placeholder_url ||
    null
  );
}

function inferAssetKind(row: any): "image" | "video" {
  const metadata = row?.metadata || {};
  const imageUrl = String(row?.image_url || "").toLowerCase();
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

export default async function IdentityDetailPage({ params }: PageProps) {
  const { id } = await params;

  const auth = await ensureActiveSubscription();

  if (!auth.ok) {
    if (auth.error === "UNAUTHENTICATED") {
      redirect("/login");
    } else {
      redirect("/pricing");
    }
  }

  const authUserId = auth.user?.id;
  const profileId = auth.profile?.id;

  if (!authUserId || !profileId) {
    redirect("/pricing");
  }

  const supabase = await supabaseServer();

  const [{ data: lora, error: loraError }, { data: generations, error: generationError }] =
    await Promise.all([
      supabase
        .from("user_loras")
        .select(
          `
          id,
          user_id,
          name,
          preview_url,
          status,
          image_count,
          created_at,
          updated_at,
          training_job_id,
          progress,
          estimated_seconds_remaining,
          started_at,
          completed_at,
          error_message,
          trigger_token,
          artifact_r2_bucket,
          artifact_r2_key,
          dataset_r2_bucket,
          dataset_r2_prefix
        `
        )
        .eq("id", id)
        .eq("user_id", authUserId)
        .maybeSingle(),
      supabase
        .from("generations")
        .select(
          `
          id,
          user_id,
          prompt,
          image_url,
          created_at,
          status,
          job_type,
          body_type,
          metadata
        `
        )
        .eq("user_id", profileId)
        .order("created_at", { ascending: false }),
    ]);

  if (loraError) {
    console.error("[identity-detail] Failed to load lora:", loraError);
  }

  if (generationError) {
    console.error("[identity-detail] Failed to load generations:", generationError);
  }

  if (!lora) {
    notFound();
  }

  const linkedAssets: IdentityDetailAsset[] = (generations || [])
    .filter((row: any) => row?.metadata?.identity_lora === lora.id)
    .map((row: any) => ({
      id: row.id,
      kind: inferAssetKind(row),
      url: inferAssetUrl(row) || "",
      prompt: row.prompt || "",
      createdAt: row.created_at || new Date().toISOString(),
      status: row.status || "unknown",
      mode: row.job_type || row?.metadata?.mode || null,
      bodyMode: row.body_type || row?.metadata?.body_mode || null,
    }))
    .filter((asset) => Boolean(asset.url));

  const imageCount = linkedAssets.filter((a) => a.kind === "image").length;
  const videoCount = linkedAssets.filter((a) => a.kind === "video").length;

  const detail: IdentityDetailData = {
    id: lora.id,
    name:
      typeof lora.name === "string" && lora.name.trim().length > 0
        ? lora.name.trim()
        : `Identity ${lora.id.slice(0, 8)}`,
    status: lora.status || "unknown",
    triggerToken: lora.trigger_token || null,
    createdAt: lora.created_at || lora.updated_at || new Date().toISOString(),
    completedAt: lora.completed_at || null,
    progress: typeof lora.progress === "number" ? lora.progress : null,
    datasetImageCount:
      typeof lora.image_count === "number" ? lora.image_count : null,
    previewUrl: lora.preview_url || linkedAssets.find((a) => a.kind === "image")?.url || null,
    artifactKey: lora.artifact_r2_key || null,
    datasetPrefix: lora.dataset_r2_prefix || null,
    imageCount,
    videoCount,
    totalAssets: linkedAssets.length,
    assets: linkedAssets,
  };

  return <IdentityDetailClient identity={detail} />;
}