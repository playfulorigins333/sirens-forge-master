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

function inferAssetUrl(row: GenerationRow): string | null {
  const metadata = row?.metadata || {};
  return (
    row?.image_url ||
    metadata?.video_url ||
    metadata?.output_url ||
    metadata?.placeholder_url ||
    null
  );
}

function inferAssetKind(row: GenerationRow): "image" | "video" {
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
    String(metadata?.mode || row?.mode || row?.job_type || "").toLowerCase().includes("video")
  ) {
    return "video";
  }

  return "image";
}

function pickIdentityCoverUrl(
  loraPreviewUrl: string | null | undefined,
  linkedAssets: GenerationRow[]
): string | null {
  if (loraPreviewUrl && String(loraPreviewUrl).trim().length > 0) {
    return loraPreviewUrl;
  }

  const latestImageAsset = linkedAssets.find(
    (row) => inferAssetUrl(row) && inferAssetKind(row) === "image"
  );
  if (latestImageAsset) {
    return inferAssetUrl(latestImageAsset);
  }

  const latestVideoAsset = linkedAssets.find(
    (row) => inferAssetUrl(row) && inferAssetKind(row) === "video"
  );
  if (latestVideoAsset) {
    return inferAssetUrl(latestVideoAsset);
  }

  return null;
}

function matchesIdentityLink(
  row: GenerationRow,
  identityId: string,
  triggerToken: string | null | undefined
) {
  const metadata = row?.metadata || {};
  const loraUsed =
    typeof row?.lora_used === "string" && row.lora_used.trim().length > 0
      ? row.lora_used.trim()
      : null;

  const metadataIdentityLora =
    typeof metadata?.identity_lora === "string" && metadata.identity_lora.trim().length > 0
      ? metadata.identity_lora.trim()
      : null;

  const normalizedTrigger =
    typeof triggerToken === "string" && triggerToken.trim().length > 0
      ? triggerToken.trim()
      : null;

  if (loraUsed === identityId) return true;
  if (normalizedTrigger && loraUsed === normalizedTrigger) return true;
  if (metadataIdentityLora === identityId) return true;
  if (normalizedTrigger && metadataIdentityLora === normalizedTrigger) return true;

  return false;
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

    // Pull both possible user_id contracts so overview matches reality.
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
    const linkedAssets = generationRows.filter((row) =>
      matchesIdentityLink(row, lora.id, lora.trigger_token || null)
    );

    const coverUrl = pickIdentityCoverUrl(lora.preview_url, linkedAssets);

    const imageCount = linkedAssets.filter(
      (row) => inferAssetKind(row) === "image"
    ).length;

    const videoCount = linkedAssets.filter(
      (row) => inferAssetKind(row) === "video"
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