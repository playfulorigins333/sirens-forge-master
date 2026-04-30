// app/library/page.tsx
import { redirect } from "next/navigation";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { supabaseServer } from "@/lib/supabaseServer";
import LibraryClient, { LibraryItem } from "./LibraryClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sirens Forge — Vault",
};

type GenerationRow = {
  id: string;
  user_id: string | null;
  prompt: string | null;
  image_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  status: string | null;
  job_type: string | null;
  body_type: string | null;
  metadata: Record<string, unknown> | null;
  lora_used?: string | null;
  mode?: string | null;
};

type UserLoraRow = {
  id: string;
  user_id: string | null;
  name: string | null;
  lora_url: string | null;
  preview_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  description: string | null;
  status: string | null;
  image_count: number | null;
  source?: string | null;
  base_model?: string | null;
  prompt?: string | null;
  negative_prompt?: string | null;
  selection?: Record<string, unknown> | null;
  is_identity_seed?: boolean | null;
  trigger_token?: string | null;
};

type IdentityStats = {
  generationCount: number;
  lastUsedAt: string | null;
};

function getMetadata(row: GenerationRow): Record<string, unknown> {
  return row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata
    : {};
}

function isCompletedStatus(row: GenerationRow): boolean {
  return String(row?.status || "").trim().toLowerCase() === "completed";
}

function isPlaceholderRow(row: GenerationRow): boolean {
  const metadata = getMetadata(row);
  return metadata.placeholder === true;
}

function getRealAssetUrl(row: GenerationRow): string | null {
  if (isPlaceholderRow(row)) {
    return null;
  }

  const metadata = getMetadata(row);
  const candidates = [row?.image_url, metadata.video_url, metadata.output_url];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function getAssetKind(row: GenerationRow, url: string): "image" | "video" {
  const metadata = getMetadata(row);
  const normalizedUrl = url.toLowerCase().split("?")[0].split("#")[0];
  const normalizedMode = String(metadata.mode || row.mode || row.job_type || "").toLowerCase();

  if (
    normalizedUrl.endsWith(".mp4") ||
    normalizedUrl.endsWith(".webm") ||
    normalizedUrl.endsWith(".mov") ||
    normalizedUrl.endsWith(".m4v") ||
    normalizedMode.includes("video")
  ) {
    return "video";
  }

  return "image";
}

function isRealAsset(row: GenerationRow): boolean {
  return isCompletedStatus(row) && !isPlaceholderRow(row) && !!getRealAssetUrl(row);
}

function getBodyMode(row: GenerationRow): string | null {
  const metadata = getMetadata(row);
  const request =
    metadata.request && typeof metadata.request === "object" && !Array.isArray(metadata.request)
      ? (metadata.request as Record<string, unknown>)
      : {};

  const candidates = [row?.body_type, metadata.body_mode, request.body_mode];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function getGenerationMode(row: GenerationRow): string | null {
  const metadata = getMetadata(row);
  const candidates = [row?.job_type, row?.mode, metadata.mode];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function getIdentityLora(row: GenerationRow): string | null {
  return typeof row?.lora_used === "string" && row.lora_used.trim().length > 0
    ? row.lora_used.trim()
    : null;
}

function isIdentitySeed(row: UserLoraRow): boolean {
  const source = String(row?.source || "").trim().toLowerCase();
  const status = String(row?.status || "").trim().toLowerCase();

  return (
    row?.is_identity_seed === true ||
    source === "build_my_model" ||
    status === "identity_seed" ||
    status === "draft"
  );
}

function getIdentitySeedPrompt(row: UserLoraRow): string {
  if (typeof row?.prompt === "string" && row.prompt.trim().length > 0) {
    return row.prompt.trim();
  }

  if (typeof row?.description === "string" && row.description.trim().length > 0) {
    return row.description.trim();
  }

  return row?.name ? `Identity seed: ${row.name}` : "Build My Model identity seed";
}

function getIdentitySeedBodyMode(row: UserLoraRow): string | null {
  if (typeof row?.base_model === "string" && row.base_model.trim().length > 0) {
    return row.base_model.trim();
  }

  const selection =
    row?.selection && typeof row.selection === "object" && !Array.isArray(row.selection)
      ? row.selection
      : {};

  const value = selection.baseModel;

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getIdentitySeedName(row: UserLoraRow): string {
  if (typeof row?.name === "string" && row.name.trim().length > 0) {
    return row.name.trim();
  }

  const bodyMode = getIdentitySeedBodyMode(row);
  return bodyMode ? `${bodyMode} identity seed` : "Build My Model identity";
}

function getIdentitySeedPreview(row: UserLoraRow): string | null {
  return typeof row?.preview_url === "string" && row.preview_url.trim().length > 0
    ? row.preview_url.trim()
    : null;
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

  const authUserId = auth.user?.id;
  const profileId = auth.profile?.id;

  if (!authUserId || !profileId) {
    redirect("/pricing");
  }

  const supabase = await supabaseServer();

  const [{ data: generationData, error: generationError }, { data: loraData, error: loraError }] =
    await Promise.all([
      supabase
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
          metadata,
          lora_used,
          mode
        `
        )
        .in("user_id", [authUserId, profileId])
        .order("created_at", { ascending: false }),

      supabase
        .from("user_loras")
        .select(
          `
          id,
          user_id,
          name,
          lora_url,
          preview_url,
          created_at,
          updated_at,
          description,
          status,
          image_count,
          source,
          base_model,
          prompt,
          negative_prompt,
          selection,
          is_identity_seed,
          trigger_token
        `
        )
        .in("user_id", [authUserId, profileId])
        .order("created_at", { ascending: false }),
    ]);

  if (generationError) {
    console.error("[library] Failed to load generations:", generationError);
  }

  if (loraError) {
    console.error("[library] Failed to load identity seeds:", loraError);
  }

  const generationRows: GenerationRow[] = Array.isArray(generationData)
    ? (generationData as GenerationRow[])
    : [];

  const loraRows: UserLoraRow[] = Array.isArray(loraData) ? (loraData as UserLoraRow[]) : [];

  const identityStatsByLora = new Map<string, IdentityStats>();

  for (const row of generationRows) {
    if (!isRealAsset(row)) continue;

    const identityId = getIdentityLora(row);
    if (!identityId) continue;

    const current = identityStatsByLora.get(identityId) || {
      generationCount: 0,
      lastUsedAt: null,
    };

    const createdAt = row.created_at || row.updated_at || null;

    current.generationCount += 1;

    if (createdAt) {
      const currentTime = current.lastUsedAt
        ? new Date(current.lastUsedAt).getTime()
        : 0;
      const nextTime = new Date(createdAt).getTime();

      if (!Number.isNaN(nextTime) && nextTime >= currentTime) {
        current.lastUsedAt = createdAt;
      }
    }

    identityStatsByLora.set(identityId, current);
  }

  const emptyIdentityStats: IdentityStats = {
    generationCount: 0,
    lastUsedAt: null,
  };

  const generationItems: LibraryItem[] = generationRows
    .filter((row) => isRealAsset(row))
    .map((row) => {
      const url = getRealAssetUrl(row)!;

      return {
        id: row.id,
        itemType: "asset",
        kind: getAssetKind(row, url),
        url,
        prompt: row.prompt || "",
        createdAt: row.created_at || row.updated_at || new Date().toISOString(),
        status: row.status || "unknown",
        mode: getGenerationMode(row),
        bodyMode: getBodyMode(row),
        identityLora: getIdentityLora(row),
        title: null,
        previewUrl: url,
        isIdentitySeed: false,
        identityStats: getIdentityLora(row)
          ? identityStatsByLora.get(getIdentityLora(row)!) || emptyIdentityStats
          : emptyIdentityStats,
      };
    });

  const identityItems: LibraryItem[] = loraRows
    .filter((row) => isIdentitySeed(row))
    .map((row) => {
      const previewUrl = getIdentitySeedPreview(row);

      return {
        id: row.id,
        itemType: "identity_seed",
        kind: "identity",
        url: previewUrl,
        prompt: getIdentitySeedPrompt(row),
        createdAt: row.created_at || row.updated_at || new Date().toISOString(),
        status: row.status || "identity_seed",
        mode: "identity_seed",
        bodyMode: getIdentitySeedBodyMode(row),
        identityLora: row.id,
        title: getIdentitySeedName(row),
        previewUrl,
        isIdentitySeed: true,
        identityStats: identityStatsByLora.get(row.id) || emptyIdentityStats,
      };
    });

  const items = [...identityItems, ...generationItems].sort((a, b) => {
    const at = new Date(a.createdAt).getTime();
    const bt = new Date(b.createdAt).getTime();
    const safeAt = Number.isNaN(at) ? 0 : at;
    const safeBt = Number.isNaN(bt) ? 0 : bt;
    return safeBt - safeAt;
  });

  return <LibraryClient items={items} />;
}
