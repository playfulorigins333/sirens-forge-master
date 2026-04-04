import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import IdentityDetailClient from "./IdentityDetailClient";

type IdentityDetailAsset = {
  id: string;
  kind: "image" | "video";
  url: string;
  prompt: string;
  createdAt: string;
  status: string;
  mode: string | null;
  bodyMode: string | null;
};

type IdentityDetailData = {
  id: string;
  name: string;
  status: string;
  triggerToken: string | null;
  createdAt: string;
  completedAt: string | null;
  progress: number | null;
  datasetImageCount: number | null;
  previewUrl: string | null;
  previewKind: "image" | "video" | null;
  artifactKey: string | null;
  datasetPrefix: string | null;
  imageCount: number;
  videoCount: number;
  totalAssets: number;
  assets: IdentityDetailAsset[];
};

type UserLoraRow = Record<string, unknown>;
type GenerationRow = Record<string, unknown>;
type GenerationMetadata = Record<string, unknown>;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asDateString(value: unknown, fallback = new Date(0).toISOString()): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function getMetadata(row: GenerationRow): GenerationMetadata {
  const value = row.metadata;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as GenerationMetadata)
    : {};
}

function isCompletedStatus(row: GenerationRow): boolean {
  return String(row.status || "").trim().toLowerCase() === "completed";
}

function isPlaceholderRow(row: GenerationRow): boolean {
  const metadata = getMetadata(row);
  return metadata.placeholder === true;
}

function getRealAssetUrl(row: GenerationRow): string | null {
  if (isPlaceholderRow(row)) return null;

  const metadata = getMetadata(row);

  const candidates = [
    row.image_url,
    metadata.video_url,
    metadata.output_url,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function getAssetKind(url: string): "image" | "video" {
  const clean = url.toLowerCase().split("?")[0].split("#")[0];

  if (
    clean.endsWith(".mp4") ||
    clean.endsWith(".webm") ||
    clean.endsWith(".mov") ||
    clean.endsWith(".m4v")
  ) {
    return "video";
  }

  return "image";
}

function isRealAsset(row: GenerationRow): boolean {
  return isCompletedStatus(row) && !isPlaceholderRow(row) && !!getRealAssetUrl(row);
}

function normalizeAsset(row: GenerationRow): IdentityDetailAsset | null {
  if (!isRealAsset(row)) return null;

  const url = getRealAssetUrl(row);
  if (!url) return null;

  return {
    id: asString(row.id, ""),
    kind: getAssetKind(url),
    url,
    prompt: asString(row.prompt),
    createdAt: asDateString(row.created_at),
    status: "completed",
    mode: asNullableString(row.mode),
    bodyMode: asNullableString(row.body_type),
  };
}

async function fetchGenerationsForIdentity(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
  identityId: string
): Promise<GenerationRow[]> {
  const { data, error } = await supabase
    .from("generations")
    .select("*")
    .eq("user_id", userId)
    .eq("lora_used", identityId)
    .order("created_at", { ascending: false });

  if (error || !Array.isArray(data)) return [];

  return data as GenerationRow[];
}

export default async function IdentityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables.");
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {},
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: identityRow } = await supabase
    .from("user_loras")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!identityRow) {
    notFound();
  }

  const generationRows = await fetchGenerationsForIdentity(
    supabase,
    user.id,
    id
  );

  const assets = generationRows
    .map(normalizeAsset)
    .filter((a): a is IdentityDetailAsset => a !== null);

  const previewAsset = assets[0] ?? null;

  const previewUrl =
    asNullableString(identityRow.preview_url) ??
    previewAsset?.url ??
    null;

  const previewKind = previewUrl ? getAssetKind(previewUrl) : null;

  const imageCount = assets.filter((a) => a.kind === "image").length;
  const videoCount = assets.filter((a) => a.kind === "video").length;

  const identity: IdentityDetailData = {
    id: asString(identityRow.id, id),
    name: asString(identityRow.name, "Unnamed Identity"),
    status: asString(identityRow.status, "draft"),
    triggerToken: asNullableString(identityRow.trigger_token),
    createdAt: asDateString(identityRow.created_at),
    completedAt: asNullableString(identityRow.completed_at),
    progress: asNumber(identityRow.progress),
    datasetImageCount: asNumber(identityRow.image_count),
    previewUrl,
    previewKind,
    artifactKey: asNullableString(identityRow.artifact_r2_key),
    datasetPrefix: asNullableString(identityRow.dataset_r2_prefix),
    imageCount,
    videoCount,
    totalAssets: assets.length,
    assets,
  };

  return <IdentityDetailClient identity={identity} />;
}