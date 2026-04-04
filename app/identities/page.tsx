// app/identities/page.tsx
import { redirect } from "next/navigation";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { supabaseServer } from "@/lib/supabaseServer";
import IdentitiesClient, { IdentityCardItem } from "./IdentitiesClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sirens Forge — My Identities",
};

type GenerationRow = {
  id: string;
  user_id: string | null;
  prompt: string | null;
  image_url: string | null;
  created_at: string | null;
  status: string | null;
  metadata: any;
  lora_used?: string | null;
  job_type?: string | null;
  mode?: string | null;
};

function isCompletedStatus(row: GenerationRow): boolean {
  return String(row?.status || "").trim().toLowerCase() === "completed";
}

function isPlaceholderRow(row: GenerationRow): boolean {
  return row?.metadata?.placeholder === true;
}

function inferRealAssetUrl(row: GenerationRow): string | null {
  if (isPlaceholderRow(row)) {
    return null;
  }

  const metadata = row?.metadata || {};

  const candidates = [
    row?.image_url,
    metadata?.video_url,
    metadata?.output_url,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function inferRealAssetKind(row: GenerationRow): "image" | "video" {
  const metadata = row?.metadata || {};
  const imageUrl = String(row?.image_url || "").toLowerCase();
  const outputUrl = String(
    metadata?.video_url ||
      metadata?.output_url ||
      ""
  ).toLowerCase();

  if (
    imageUrl.endsWith(".mp4") ||
    imageUrl.endsWith(".webm") ||
    outputUrl.endsWith(".mp4") ||
    outputUrl.endsWith(".webm") ||
    String(metadata?.mode || row?.mode || row?.job_type || "").toLowerCase().includes("video")
  ) {
    return "video";
  }

  return "image";
}

function isRealAsset(row: GenerationRow): boolean {
  return isCompletedStatus(row) && !isPlaceholderRow(row) && !!inferRealAssetUrl(row);
}

function pickIdentityCoverUrl(
  loraPreviewUrl: string | null | undefined,
  linkedAssets: GenerationRow[]
): string | null {
  if (loraPreviewUrl && String(loraPreviewUrl).trim().length > 0) {
    return loraPreviewUrl;
  }

  const latestImageAsset = linkedAssets.find(
    (row) => inferRealAssetUrl(row) && inferRealAssetKind(row) === "image"
  );
  if (latestImageAsset) {
    return inferRealAssetUrl(latestImageAsset);
  }

  const latestVideoAsset = linkedAssets.find(
    (row) => inferRealAssetUrl(row) && inferRealAssetKind(row) === "video"
  );
  if (latestVideoAsset) {
    return inferRealAssetUrl(latestVideoAsset);
  }

  return null;
}

function matchesIdentityLink(row: GenerationRow, identityId: string) {
  const loraUsed =
    typeof row?.lora_used === "string" && row.lora_used.trim().length > 0
      ? row.lora_used.trim()
      : null;

  return loraUsed === identityId;
}

export default async function IdentitiesPage() {
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

  const [
    { data: loras, error: loraError },
    { data: generations, error: generationError },
  ] = await Promise.all([
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
          artifact_r2_key
        `
      )
      .eq("user_id", authUserId)
      .order("created_at", { ascending: false }),

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
          metadata,
          lora_used,
          job_type,
          mode
        `
      )
      .in("user_id", [authUserId, profileId])
      .order("created_at", { ascending: false }),
  ]);

  if (loraError) {
    console.error("[identities] Failed to load user_loras:", loraError);
  }

  if (generationError) {
    console.error("[identities] Failed to load generations:", generationError);
  }

  const generationRows: GenerationRow[] = Array.isArray(generations) ? generations : [];

  const items: IdentityCardItem[] = (loras || []).map((lora: any) => {
    const linkedAssets = generationRows.filter(
      (row) => isRealAsset(row) && matchesIdentityLink(row, lora.id)
    );

    const coverUrl = pickIdentityCoverUrl(lora.preview_url, linkedAssets);

    const imageCount = linkedAssets.filter(
      (row) => inferRealAssetKind(row) === "image"
    ).length;

    const videoCount = linkedAssets.filter(
      (row) => inferRealAssetKind(row) === "video"
    ).length;

    return {
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
      imageCount,
      videoCount,
      totalAssets: linkedAssets.length,
      datasetImageCount:
        typeof lora.image_count === "number" ? lora.image_count : null,
      coverUrl,
      artifactKey: lora.artifact_r2_key || null,
    };
  });

  return <IdentitiesClient items={items} />;
}