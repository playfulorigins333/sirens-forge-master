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

function inferKindFromUrl(url?: string | null): "image" | "video" | null {
  if (!url) return null;

  const clean = url.toLowerCase().split("?")[0].split("#")[0];

  if (
    clean.endsWith(".mp4") ||
    clean.endsWith(".webm") ||
    clean.endsWith(".mov") ||
    clean.endsWith(".m4v")
  ) {
    return "video";
  }

  if (
    clean.endsWith(".jpg") ||
    clean.endsWith(".jpeg") ||
    clean.endsWith(".png") ||
    clean.endsWith(".webp") ||
    clean.endsWith(".gif") ||
    clean.endsWith(".avif")
  ) {
    return "image";
  }

  return null;
}

function pickFirstString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function normalizeAsset(row: GenerationRow): IdentityDetailAsset | null {
  const id = asString(row.id, "");
  if (!id) return null;

  const directVideoUrl = pickFirstString(row, [
    "video_url",
    "output_video_url",
    "final_video_url",
    "asset_video_url",
  ]);

  const directImageUrl = pickFirstString(row, [
    "image_url",
    "output_url",
    "final_image_url",
    "asset_url",
    "thumbnail_url",
  ]);

  const fallbackUrl = pickFirstString(row, ["url"]);
  const url = directVideoUrl || directImageUrl || fallbackUrl;

  if (!url) return null;

  const explicitKind =
    asNullableString(row.kind) ||
    asNullableString(row.media_kind) ||
    asNullableString(row.asset_kind) ||
    asNullableString(row.output_kind);

  const kind =
    explicitKind === "image" || explicitKind === "video"
      ? explicitKind
      : directVideoUrl
        ? "video"
        : directImageUrl
          ? "image"
          : inferKindFromUrl(url);

  if (!kind) return null;

  return {
    id,
    kind,
    url,
    prompt:
      asString(row.prompt) ||
      asString(row.final_prompt) ||
      asString(row.positive_prompt) ||
      "",
    createdAt: asDateString(row.created_at ?? row.updated_at ?? row.generated_at),
    status: asString(row.status, "completed"),
    mode: asNullableString(row.mode),
    bodyMode: asNullableString(row.body_mode) ?? asNullableString(row.bodyMode),
  };
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
      setAll() {
        // no-op in server component
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: identityRow, error: identityError } = await supabase
    .from("user_loras")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (identityError) {
    throw new Error(`user_loras query failed: ${identityError.message}`);
  }

  if (!identityRow) {
    notFound();
  }

  let generationRows: GenerationRow[] = [];

  const generationsResult = await supabase
    .from("generations")
    .select("*")
    .eq("user_id", user.id)
    .eq("identity_lora", id)
    .order("created_at", { ascending: false });

  if (!generationsResult.error && Array.isArray(generationsResult.data)) {
    generationRows = generationsResult.data as GenerationRow[];
  } else {
    console.error("Identity detail generations query failed:", generationsResult.error);
  }

  const assets = generationRows
    .map(normalizeAsset)
    .filter((item): item is IdentityDetailAsset => item !== null);

  const previewAsset = assets[0] ?? null;

  const previewUrl =
    pickFirstString(identityRow as UserLoraRow, [
      "preview_url",
      "hero_url",
      "thumbnail_url",
      "cover_url",
      "artifact_preview_url",
    ]) ??
    previewAsset?.url ??
    null;

  const previewKind =
    previewAsset && previewUrl === previewAsset.url
      ? previewAsset.kind
      : inferKindFromUrl(previewUrl);

  const imageCount = assets.filter((asset) => asset.kind === "image").length;
  const videoCount = assets.filter((asset) => asset.kind === "video").length;

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
    datasetPrefix:
      asNullableString(identityRow.dataset_r2_prefix) ??
      asNullableString(identityRow.dataset_prefix),
    imageCount,
    videoCount,
    totalAssets: assets.length,
    assets,
  };

  return <IdentityDetailClient identity={identity} />;
}