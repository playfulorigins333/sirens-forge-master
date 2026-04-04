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
      metadata,
      lora_used,
      mode
    `
    )
    .in("user_id", [authUserId, profileId])
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[library] Failed to load generations:", error);
  }

  const rows: GenerationRow[] = Array.isArray(data) ? (data as GenerationRow[]) : [];

  const items: LibraryItem[] = rows
    .filter((row) => isRealAsset(row))
    .map((row) => {
      const url = getRealAssetUrl(row)!;

      return {
        id: row.id,
        kind: getAssetKind(row, url),
        url,
        prompt: row.prompt || "",
        createdAt: row.created_at || row.updated_at || new Date().toISOString(),
        status: row.status || "unknown",
        mode: getGenerationMode(row),
        bodyMode: getBodyMode(row),
        identityLora: getIdentityLora(row),
      };
    });

  return <LibraryClient items={items} />;
}