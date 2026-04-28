import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Brain,
  Wand2,
  Library,
  ChevronRight,
  Sparkles,
  User,
  Users,
  Flame,
  Dna,
  Image as ImageIcon,
  Video as VideoIcon,
} from "lucide-react";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { supabaseServer } from "@/lib/supabaseServer";
import LogoutButton from "@/components/LogoutButton";

export const metadata = {
  title: "Sirens Forge — Dashboard",
};

type GenerationRow = {
  id: string;
  user_id: string | null;
  prompt: string | null;
  image_url: string | null;
  created_at: string | null;
  updated_at?: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
  lora_used?: string | null;
  job_type?: string | null;
  mode?: string | null;
};

type LoraRow = {
  id: string;
  name: string | null;
  preview_url: string | null;
  status: string | null;
  image_count: number | null;
  created_at: string | null;
  updated_at: string | null;
  trigger_token: string | null;
};

type ContinueIdentity = {
  id: string;
  name: string;
  previewUrl: string | null;
  previewKind: "image" | "video" | null;
  lastPrompt: string;
  lastCreatedAt: string | null;
  totalAssets: number;
  imageCount: number;
  videoCount: number;
  datasetImageCount: number | null;
};

type DailySirenScene = {
  label: string;
  title: string;
  prompt: string;
  tone: string;
  border: string;
  badge: string;
};

const DAILY_SIREN_SCENE_BANK: DailySirenScene[] = [
  {
    label: "Spicy",
    title: "Neon Nude Heat",
    prompt:
      "photorealistic nude woman, provocative pose, body angled toward camera, hips slightly forward, direct intense eye contact, teasing expression, neon lighting, cinematic shadows, high detail",
    tone: "from-fuchsia-950/45 via-black/60 to-cyan-950/35",
    border: "border-fuchsia-400/30 hover:border-cyan-300/60",
    badge: "Heat",
  },
  {
    label: "Spicy",
    title: "Private Suite Nude",
    prompt:
      "photorealistic nude woman in a luxury suite, confident pose, arched posture, body visible, direct eye contact, soft dramatic lighting, cinematic realism, high detail",
    tone: "from-purple-950/45 via-black/60 to-pink-950/35",
    border: "border-purple-400/30 hover:border-pink-300/60",
    badge: "Suite",
  },
  {
    label: "Spicy",
    title: "Sweat Glow Nude",
    prompt:
      "photorealistic nude woman with light sweat sheen, close framing, strong body positioning, parted lips, intense gaze, dramatic shadows, cinematic lighting, high detail",
    tone: "from-rose-950/45 via-black/60 to-orange-950/30",
    border: "border-rose-400/30 hover:border-orange-300/60",
    badge: "Glow",
  },
  {
    label: "Spicy",
    title: "Dark Room Nude",
    prompt:
      "photorealistic nude woman in a dark room, spotlight lighting, strong pose, hips forward, direct eye contact, moody shadows, cinematic detail",
    tone: "from-zinc-950/60 via-black/70 to-purple-950/30",
    border: "border-zinc-400/30 hover:border-purple-300/60",
    badge: "Spotlight",
  },
  {
    label: "Spicy",
    title: "Balcony Night Nude",
    prompt:
      "photorealistic nude woman on a balcony at night, city lights behind, confident stance, body angled toward camera, wind in hair, cinematic lighting",
    tone: "from-indigo-950/45 via-black/60 to-cyan-950/30",
    border: "border-indigo-400/30 hover:border-cyan-300/60",
    badge: "Night",
  },
  {
    label: "Spicy",
    title: "Red Light Nude",
    prompt:
      "photorealistic nude woman in red lighting, provocative pose, close framing, direct eye contact, intense expression, cinematic shadows, high detail",
    tone: "from-red-950/50 via-black/65 to-pink-950/30",
    border: "border-red-400/30 hover:border-pink-300/60",
    badge: "Red light",
  },
  {
    label: "Spicy",
    title: "Steam Room Nude",
    prompt:
      "photorealistic nude woman in a luxury steam room, body angled toward camera, confident pose, warm mist, soft dramatic lighting, realistic skin texture",
    tone: "from-stone-950/45 via-black/60 to-pink-950/25",
    border: "border-stone-400/30 hover:border-pink-300/60",
    badge: "Steam",
  },
  {
    label: "Spicy",
    title: "Late Night Nude Energy",
    prompt:
      "photorealistic nude woman in a dim bedroom, bold pose, hips forward, arched posture, direct eye contact, cinematic lighting, high detail",
    tone: "from-purple-950/45 via-black/60 to-rose-950/35",
    border: "border-purple-400/30 hover:border-rose-300/60",
    badge: "Late night",
  },
  {
    label: "Spicy",
    title: "Silhouette Nude Drama",
    prompt:
      "photorealistic nude woman in silhouette lighting, strong curves, arched posture, dramatic contrast, cinematic composition, high detail",
    tone: "from-red-950/35 via-black/65 to-zinc-950/45",
    border: "border-red-400/30 hover:border-zinc-300/60",
    badge: "Silhouette",
  },
  {
    label: "Spicy",
    title: "Mirror Nude Confidence",
    prompt:
      "photorealistic nude woman standing near a mirror, confident body language, body angled slightly, teasing expression, soft lighting, cinematic realism",
    tone: "from-purple-950/40 via-black/60 to-pink-950/35",
    border: "border-purple-400/30 hover:border-pink-300/60",
    badge: "Mirror",
  },
  {
    label: "Spicy",
    title: "Bed Edge Nude Tease",
    prompt:
      "photorealistic nude woman sitting at the edge of a bed, legs angled, body leaning forward slightly, direct eye contact, soft moody lighting, high detail",
    tone: "from-pink-950/40 via-black/60 to-fuchsia-950/30",
    border: "border-pink-400/30 hover:border-fuchsia-300/60",
    badge: "Bed edge",
  },
  {
    label: "Spicy",
    title: "Poolside Nude Glow",
    prompt:
      "photorealistic nude woman beside a midnight pool, wet skin glow, confident pose, body angled toward camera, blue water reflections, cinematic lighting",
    tone: "from-blue-950/45 via-black/65 to-cyan-950/35",
    border: "border-blue-400/30 hover:border-cyan-300/60",
    badge: "Poolside",
  },
  {
    label: "Spicy",
    title: "Candlelit Nude",
    prompt:
      "photorealistic nude woman in candlelit bedroom, arched posture, direct eye contact, warm shadows, intimate cinematic mood, realistic skin texture, high detail",
    tone: "from-amber-950/40 via-black/60 to-rose-950/35",
    border: "border-amber-400/30 hover:border-amber-300/60",
    badge: "Candlelight",
  },
  {
    label: "Spicy",
    title: "VIP Lounge Nude",
    prompt:
      "photorealistic nude woman in a VIP lounge, neon reflections, confident body language, close framing, direct eye contact, high detail",
    tone: "from-fuchsia-950/40 via-black/60 to-purple-950/35",
    border: "border-fuchsia-400/30 hover:border-purple-300/60",
    badge: "VIP",
  },
  {
    label: "Spicy",
    title: "Beach Sunset Nude",
    prompt:
      "photorealistic nude woman on a private beach at sunset, relaxed provocative pose, body angled toward camera, wet hair, golden hour lighting, high detail",
    tone: "from-orange-950/35 via-black/60 to-pink-950/30",
    border: "border-orange-400/30 hover:border-orange-300/60",
    badge: "Sunset",
  },
  {
    label: "Unfiltered",
    title: "Dominant Nude Presence",
    prompt:
      "photorealistic fully nude woman, dominant posture, hips forward, arched back, direct eye contact, confident expression, dramatic lighting, high detail",
    tone: "from-red-950/45 via-black/65 to-fuchsia-950/35",
    border: "border-red-400/30 hover:border-fuchsia-300/60",
    badge: "Dominant",
  },
  {
    label: "Unfiltered",
    title: "Close Proximity Nude",
    prompt:
      "photorealistic fully nude woman in close framing, intimate positioning, direct eye contact, shallow depth of field, sensual tension, cinematic detail",
    tone: "from-pink-950/45 via-black/65 to-zinc-950/35",
    border: "border-pink-400/30 hover:border-zinc-300/60",
    badge: "Close",
  },
  {
    label: "Unfiltered",
    title: "Shadow Control Nude",
    prompt:
      "photorealistic fully nude woman in deep shadow lighting, controlled pose, powerful stance, cinematic realism, high detail",
    tone: "from-zinc-950/65 via-black/70 to-purple-950/35",
    border: "border-zinc-400/30 hover:border-purple-300/60",
    badge: "Control",
  },
  {
    label: "Unfiltered",
    title: "Penthouse Nude",
    prompt:
      "photorealistic fully nude woman in a penthouse at night, confident pose, body angled forward, intense gaze, dramatic lighting, cinematic detail",
    tone: "from-purple-950/55 via-black/65 to-pink-950/35",
    border: "border-purple-400/30 hover:border-pink-300/60",
    badge: "Penthouse",
  },
  {
    label: "Unfiltered",
    title: "Midnight Nude Energy",
    prompt:
      "photorealistic fully nude woman at midnight, strong body language, hips forward, direct eye contact, dramatic shadows, high detail",
    tone: "from-blue-950/45 via-black/65 to-purple-950/35",
    border: "border-blue-400/30 hover:border-purple-300/60",
    badge: "Midnight",
  },
  {
    label: "Unfiltered",
    title: "High Tension Nude Frame",
    prompt:
      "photorealistic fully nude woman in a high tension pose, close framing, powerful posture, direct eye contact, cinematic detail, high detail",
    tone: "from-fuchsia-950/45 via-black/65 to-red-950/35",
    border: "border-fuchsia-400/30 hover:border-red-300/60",
    badge: "Tension",
  },
  {
    label: "Unfiltered",
    title: "Spotlight Nude Control",
    prompt:
      "photorealistic fully nude woman under a single spotlight, dominant presence, controlled pose, direct intense eye contact, dramatic lighting, high detail",
    tone: "from-amber-950/35 via-black/70 to-zinc-950/45",
    border: "border-amber-400/30 hover:border-zinc-300/60",
    badge: "Spotlight",
  },
  {
    label: "Unfiltered",
    title: "After Hours Private Nude",
    prompt:
      "photorealistic fully nude woman in a private after-hours setting, confident sensual posture, body angled toward camera, cinematic lighting, high detail",
    tone: "from-pink-950/45 via-black/65 to-purple-950/35",
    border: "border-pink-400/30 hover:border-purple-300/60",
    badge: "Private",
  },
  {
    label: "Unfiltered",
    title: "Dark Room Intensity Nude",
    prompt:
      "photorealistic fully nude woman in a dark room, intense mood, strong pose, hips forward, direct eye contact, dramatic lighting, high detail",
    tone: "from-purple-950/50 via-black/70 to-red-950/30",
    border: "border-purple-400/30 hover:border-red-300/60",
    badge: "Intensity",
  },
  {
    label: "Unfiltered",
    title: "Luxury Night Nude Scene",
    prompt:
      "photorealistic fully nude woman in a luxury night setting, confident pose, body angled toward camera, cinematic lighting, high detail",
    tone: "from-indigo-950/45 via-black/65 to-pink-950/35",
    border: "border-indigo-400/30 hover:border-pink-300/60",
    badge: "Luxury",
  },
  {
    label: "Unfiltered",
    title: "Nude Power Pose",
    prompt:
      "photorealistic fully nude woman in a powerful stance, shoulders back, hips forward, dominant eye contact, dramatic cinematic lighting, high detail",
    tone: "from-zinc-950/55 via-black/70 to-red-950/35",
    border: "border-zinc-400/30 hover:border-red-300/60",
    badge: "Power",
  },
  {
    label: "Unfiltered",
    title: "Rooftop Nude After Dark",
    prompt:
      "photorealistic fully nude woman on a rooftop at night, city lights, confident body positioning, wind in hair, direct eye contact, cinematic shadows",
    tone: "from-sky-950/40 via-black/60 to-indigo-950/35",
    border: "border-sky-400/30 hover:border-sky-300/60",
    badge: "Rooftop",
  },
  {
    label: "Unfiltered",
    title: "Velvet Room Nude",
    prompt:
      "photorealistic fully nude woman in a dark velvet room, arched posture, body angled forward, commanding eye contact, warm shadows, high detail",
    tone: "from-violet-950/55 via-black/65 to-zinc-950/45",
    border: "border-violet-400/30 hover:border-violet-300/60",
    badge: "Velvet",
  },
  {
    label: "Unfiltered",
    title: "White Sheet Nude Close-Up",
    prompt:
      "photorealistic fully nude woman partially framed with white sheets, close portrait composition, direct eye contact, parted lips, natural skin texture, high detail",
    tone: "from-neutral-950/45 via-black/60 to-pink-950/25",
    border: "border-neutral-400/30 hover:border-neutral-300/60",
    badge: "Close-up",
  },
  {
    label: "Unfiltered",
    title: "Studio Nude Control",
    prompt:
      "photorealistic fully nude woman in a clean studio, controlled pose, hips angled, direct intense eye contact, premium softbox lighting, editorial detail",
    tone: "from-gray-950/55 via-black/65 to-purple-950/25",
    border: "border-gray-400/30 hover:border-gray-300/60",
    badge: "Studio",
  },
];

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

function getAssetKind(url: string, row?: GenerationRow): "image" | "video" {
  const clean = url.toLowerCase().split("?")[0].split("#")[0];
  const metadata = row ? getMetadata(row) : {};
  const mode = String(metadata.mode || row?.mode || row?.job_type || "").toLowerCase();

  if (
    clean.endsWith(".mp4") ||
    clean.endsWith(".webm") ||
    clean.endsWith(".mov") ||
    clean.endsWith(".m4v") ||
    mode.includes("video")
  ) {
    return "video";
  }

  return "image";
}

function isRealAsset(row: GenerationRow): boolean {
  return isCompletedStatus(row) && !isPlaceholderRow(row) && !!getRealAssetUrl(row);
}

function getIdentityLora(row: GenerationRow): string | null {
  return typeof row?.lora_used === "string" && row.lora_used.trim().length > 0
    ? row.lora_used.trim()
    : null;
}

function formatRelative(value?: string | null): string {
  if (!value) return "Recently";

  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "Recently";

  const diffMs = Date.now() - time;
  const minutes = Math.floor(diffMs / 1000 / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function hashString(input: string): number {
  let hash = 2166136261;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function getDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function getDailySirenScenes(userKey: string): DailySirenScene[] {
  const pool = [...DAILY_SIREN_SCENE_BANK];
  const seed = hashString(`${getDateKey()}:${userKey || "anonymous"}`);

  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = (seed + i * 17 + (seed % (i + 1))) % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, 3);
}

function makeGeneratorReadyPrompt(prompt: string): string {
  const basePrompt = String(prompt || "").trim();

  const productionDetails =
    "same woman, consistent face, detailed eyes, lips, hair, body, natural skin texture, flattering outfit styling, clear pose, cinematic scene, defined environment, premium background, soft dramatic lighting, camera angle, portrait composition, shallow depth of field, photorealistic, lifelike, high detail, moody sensual atmosphere";

  if (!basePrompt) {
    return productionDetails;
  }

  const normalizedBase = basePrompt.toLowerCase();
  const normalizedDetails = productionDetails
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !normalizedBase.includes(part.toLowerCase()));

  return [basePrompt, ...normalizedDetails].join(", ");
}

function buildGenerateHref(prompt: string, source: string, identityId?: string | null): string {
  const params = new URLSearchParams();

  params.set("prompt", makeGeneratorReadyPrompt(prompt));
  params.set("generation_target", "text_to_image");
  params.set("output_type", "IMAGE");
  params.set("source", source);

  if (identityId) {
    params.set("identity", identityId);
  }

  return `/generate?${params.toString()}`;
}

function buildContinueIdentity(
  lora: LoraRow | null,
  linkedAssets: GenerationRow[]
): ContinueIdentity | null {
  if (!lora || linkedAssets.length === 0) {
    return null;
  }

  const latestAsset = linkedAssets[0];
  const latestUrl = getRealAssetUrl(latestAsset);

  const latestImage = linkedAssets.find((row) => {
    const url = getRealAssetUrl(row);
    return url && getAssetKind(url, row) === "image";
  });

  const latestVideo = linkedAssets.find((row) => {
    const url = getRealAssetUrl(row);
    return url && getAssetKind(url, row) === "video";
  });

  const fallbackImageUrl = latestImage ? getRealAssetUrl(latestImage) : null;
  const fallbackVideoUrl = latestVideo ? getRealAssetUrl(latestVideo) : null;

  const previewUrl =
    typeof lora.preview_url === "string" && lora.preview_url.trim().length > 0
      ? lora.preview_url.trim()
      : fallbackImageUrl || latestUrl || fallbackVideoUrl;

  const previewKind = previewUrl ? getAssetKind(previewUrl, latestAsset) : null;

  const imageCount = linkedAssets.filter((row) => {
    const url = getRealAssetUrl(row);
    return url && getAssetKind(url, row) === "image";
  }).length;

  const videoCount = linkedAssets.filter((row) => {
    const url = getRealAssetUrl(row);
    return url && getAssetKind(url, row) === "video";
  }).length;

  return {
    id: lora.id,
    name:
      typeof lora.name === "string" && lora.name.trim().length > 0
        ? lora.name.trim()
        : typeof lora.trigger_token === "string" && lora.trigger_token.trim().length > 0
          ? lora.trigger_token.trim()
          : `Identity ${lora.id.slice(0, 8)}`,
    previewUrl,
    previewKind,
    lastPrompt: latestAsset.prompt || "Continue building this identity with a fresh scene.",
    lastCreatedAt: latestAsset.created_at || latestAsset.updated_at || null,
    totalAssets: linkedAssets.length,
    imageCount,
    videoCount,
    datasetImageCount: typeof lora.image_count === "number" ? lora.image_count : null,
  };
}

async function getContinueIdentity(
  authUserId: string,
  profileId: string
): Promise<ContinueIdentity | null> {
  try {
    const supabase = await supabaseServer();

    const { data: generations, error: generationError } = await supabase
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
          metadata,
          lora_used,
          job_type,
          mode
        `
      )
      .in("user_id", [authUserId, profileId])
      .not("lora_used", "is", null)
      .order("created_at", { ascending: false })
      .limit(80);

    if (generationError) {
      console.error("[dashboard] Failed to load identity-linked generations:", generationError);
      return null;
    }

    const generationRows: GenerationRow[] = Array.isArray(generations)
      ? (generations as GenerationRow[])
      : [];

    const realIdentityAssets = generationRows.filter(
      (row) => isRealAsset(row) && getIdentityLora(row)
    );

    if (realIdentityAssets.length === 0) {
      return null;
    }

    const latestIdentityId = getIdentityLora(realIdentityAssets[0]);

    if (!latestIdentityId) {
      return null;
    }

    const linkedAssets = realIdentityAssets.filter(
      (row) => getIdentityLora(row) === latestIdentityId
    );

    const { data: lora, error: loraError } = await supabase
      .from("user_loras")
      .select(
        `
          id,
          name,
          preview_url,
          status,
          image_count,
          created_at,
          updated_at,
          trigger_token
        `
      )
      .eq("id", latestIdentityId)
      .eq("user_id", authUserId)
      .maybeSingle();

    if (loraError) {
      console.error("[dashboard] Failed to load latest identity:", loraError);
      return null;
    }

    return buildContinueIdentity((lora as LoraRow | null) || null, linkedAssets);
  } catch (error) {
    console.error("[dashboard] Continue identity block failed safely:", error);
    return null;
  }
}

function ContinueIdentityBlock({ identity }: { identity: ContinueIdentity | null }) {
  if (!identity) {
    return (
      <section className="mb-8 overflow-hidden rounded-[32px] border border-purple-400/20 bg-gradient-to-br from-purple-950/25 via-black/50 to-pink-950/20 p-6 backdrop-blur-xl sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-purple-400/20 bg-purple-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-purple-200">
              <Dna className="h-3.5 w-3.5" />
              Continue Your Identity
            </div>

            <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
              Your AI Twin is ready when you are
            </h2>

            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-300 sm:text-base">
              Train an identity once, then build a repeatable character loop around it: generate, save, improve, and return.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
            <Link
              href="/lora/train"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 px-5 text-sm font-bold text-white shadow-[0_0_26px_rgba(168,85,247,0.25)] transition hover:brightness-110"
            >
              Train Your First Identity
              <ChevronRight className="ml-2 h-4 w-4" />
            </Link>

            <Link
              href="/identities"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-gray-100 transition hover:border-white/20 hover:bg-white/10"
            >
              View Identities
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const continuePrompt = identity.lastPrompt || "Continue this identity in a new cinematic scene.";
  const generateHref = buildGenerateHref(continuePrompt, "dashboard_continue_identity", identity.id);
  const identityHref = `/identities/${identity.id}`;

  return (
    <section className="mb-8 overflow-hidden rounded-[32px] border border-purple-400/20 bg-gradient-to-br from-purple-950/30 via-black/55 to-pink-950/25 backdrop-blur-xl">
      <div className="grid gap-0 lg:grid-cols-[0.72fr_1.28fr]">
        <Link
          href={identityHref}
          className="group relative min-h-[260px] overflow-hidden bg-gray-950"
        >
          {identity.previewUrl ? (
            identity.previewKind === "video" ? (
              <video
                src={identity.previewUrl}
                className="h-full min-h-[260px] w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                muted
                loop
                playsInline
                autoPlay
              />
            ) : (
              <img
                src={identity.previewUrl}
                alt={identity.name}
                className="h-full min-h-[260px] w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              />
            )
          ) : (
            <div className="flex h-full min-h-[260px] items-center justify-center bg-gradient-to-br from-purple-950/50 via-black to-pink-950/30">
              <div className="flex h-24 w-24 items-center justify-center rounded-[32px] border border-white/10 bg-black/30">
                <Dna className="h-12 w-12 text-purple-300" />
              </div>
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />

          <div className="absolute bottom-5 left-5 right-5">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-purple-400/30 bg-purple-500/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-purple-100">
              <Dna className="h-3.5 w-3.5" />
              Last Used Identity
            </div>

            <h2 className="text-2xl font-black text-white">
              {identity.name}
            </h2>

            <p className="mt-1 text-xs font-medium text-gray-300">
              Last created {formatRelative(identity.lastCreatedAt)}
            </p>
          </div>
        </Link>

        <div className="p-6 sm:p-8">
          <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-pink-400/20 bg-pink-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-pink-200">
                <Sparkles className="h-3.5 w-3.5" />
                Continue Your Identity
              </div>

              <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
                {identity.name} is waiting for the next scene
              </h2>

              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-300 sm:text-base">
                Pick up where you left off. Keep the same identity active and push the character deeper into your Vault.
              </p>
            </div>

            <div className="flex shrink-0 flex-col gap-2 sm:flex-row xl:flex-col">
              <Link
                href={generateHref}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 px-5 text-sm font-bold text-white shadow-[0_0_26px_rgba(168,85,247,0.25)] transition hover:brightness-110"
              >
                Continue Creating
                <ChevronRight className="ml-2 h-4 w-4" />
              </Link>

              <Link
                href={identityHref}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-gray-100 transition hover:border-white/20 hover:bg-white/10"
              >
                Open Identity
              </Link>
            </div>
          </div>

          <div className="mb-5 grid gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                <Sparkles className="h-3.5 w-3.5 text-purple-300" />
                Total
              </div>
              <p className="text-2xl font-black text-purple-100">
                {identity.totalAssets}
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                <ImageIcon className="h-3.5 w-3.5 text-pink-300" />
                Images
              </div>
              <p className="text-2xl font-black text-pink-100">
                {identity.imageCount}
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                <VideoIcon className="h-3.5 w-3.5 text-cyan-300" />
                Videos
              </div>
              <p className="text-2xl font-black text-cyan-100">
                {identity.videoCount}
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                <Dna className="h-3.5 w-3.5 text-yellow-300" />
                Training
              </div>
              <p className="text-2xl font-black text-yellow-100">
                {identity.datasetImageCount ?? 0}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
              Last Prompt
            </div>
            <p className="line-clamp-3 text-sm leading-relaxed text-gray-300">
              {identity.lastPrompt}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default async function DashboardPage() {
  const auth = await ensureActiveSubscription();

  if (!auth.ok) {
    if (auth.error === "UNAUTHENTICATED") {
      redirect("/login");
    } else {
      redirect("/pricing");
    }
  }

  const authUserId = auth.user?.id;
  const profileId = auth.profile?.id || authUserId || "";
  const continueIdentity =
    authUserId && profileId ? await getContinueIdentity(authUserId, profileId) : null;
  const dailyScenes = getDailySirenScenes(authUserId || profileId || "sirensforge");

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-950/60 via-black to-pink-950/60" />
        <div className="absolute top-0 left-0 h-[1000px] w-[1000px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-600/20 blur-[140px]" />
        <div className="absolute right-0 bottom-0 h-[1000px] w-[1000px] translate-x-1/2 translate-y-1/2 rounded-full bg-pink-600/20 blur-[140px]" />
        <div className="absolute top-1/2 left-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-600/10 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1760px] flex-col px-6 pt-24 pb-16 sm:px-8 xl:px-10">
        <div className="mb-12 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-4xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300 backdrop-blur-xl">
              <Sparkles className="h-4 w-4" />
              Dashboard
            </div>

            <h1 className="mb-4 text-4xl font-black tracking-tight sm:text-5xl md:text-6xl">
              What do you want to create today?
            </h1>

            <p className="max-w-3xl text-lg leading-relaxed font-medium text-gray-300 sm:text-xl">
              Start with guided prompt creation, jump straight into generation, build your AI Twin, or grow with the affiliate program.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-3 self-start">
            <Link
              href="/account"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-gray-100 transition hover:border-white/20 hover:bg-white/10"
            >
              Account
            </Link>
            <LogoutButton />
          </div>
        </div>

        <ContinueIdentityBlock identity={continueIdentity} />

        <section className="mb-8 overflow-hidden rounded-[32px] border border-pink-400/20 bg-gradient-to-br from-pink-950/25 via-black/50 to-cyan-950/20 p-6 backdrop-blur-xl sm:p-8">
          <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-pink-400/20 bg-pink-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-pink-200">
                <Flame className="h-3.5 w-3.5" />
                Daily Siren Loop
              </div>

              <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
                Your Siren has 3 scenes for you today
              </h2>

              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-300 sm:text-base">
                Skip the blank prompt box. These rotate daily from a larger scene bank, then hand off cleanly to the Generator.
              </p>
            </div>

            <Link
              href="/sirens-mind"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-gray-100 transition hover:border-pink-300/40 hover:bg-white/10"
            >
              Refine in Siren&apos;s Mind
              <ChevronRight className="ml-2 h-4 w-4" />
            </Link>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {dailyScenes.map((scene) => (
              <Link
                key={scene.title}
                href={buildGenerateHref(scene.prompt, "daily_siren_loop", continueIdentity?.id || null)}
                className={`group relative overflow-hidden rounded-[24px] border ${scene.border} bg-gradient-to-br ${scene.tone} p-6 transition-all hover:-translate-y-1 hover:bg-white/10 hover:shadow-[0_0_34px_rgba(236,72,153,0.14)]`}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-pink-500/10 opacity-0 transition-opacity group-hover:opacity-100" />

                <div className="relative">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                      {scene.label}
                    </span>
                    <span className="rounded-full border border-pink-400/20 bg-pink-500/10 px-3 py-1 text-[11px] font-semibold text-pink-200">
                      {scene.badge}
                    </span>
                  </div>

                  <h3 className="mb-3 text-xl font-bold text-white">
                    {scene.title}
                  </h3>

                  <p className="mb-5 line-clamp-3 text-sm leading-relaxed text-gray-300">
                    {scene.prompt}
                  </p>

                  <div className="inline-flex items-center gap-2 text-sm font-semibold text-pink-200 transition group-hover:text-white">
                    Use This Scene
                    <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-5">
          <Link
            href="/lora/train"
            className="group relative overflow-hidden rounded-[28px] border border-pink-400/30 bg-gradient-to-br from-pink-950/40 via-black/50 to-purple-950/30 p-8 backdrop-blur-xl transition-all hover:border-pink-300/50 hover:bg-white/10"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-pink-500/15 via-transparent to-purple-500/10 opacity-0 transition-opacity group-hover:opacity-100" />

            <div className="relative">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-500 to-purple-500 shadow-lg">
                <User className="h-8 w-8 text-white" />
              </div>

              <div className="mb-3 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                🔥 Creator Essential
              </div>

              <h2 className="mb-3 text-2xl font-bold text-white">
                AI Twin
              </h2>

              <p className="mb-6 text-base leading-relaxed font-medium text-gray-300">
                Train a consistent version of yourself and generate content that matches your look every time.
              </p>

              <div className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-200 transition group-hover:text-white">
                Train Your Twin
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </Link>

          <Link
            href="/sirens-mind"
            className="group relative overflow-hidden rounded-[28px] border border-purple-400/20 bg-gradient-to-br from-purple-950/40 via-black/50 to-cyan-950/20 p-8 backdrop-blur-xl transition-all hover:border-purple-300/40 hover:bg-white/10"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-transparent to-pink-500/10 opacity-0 transition-opacity group-hover:opacity-100" />

            <div className="relative">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg">
                <Brain className="h-8 w-8 text-white" />
              </div>

              <div className="mb-3 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                Guided Start
              </div>

              <h2 className="mb-3 text-2xl font-bold text-white">
                Siren&apos;s Mind
              </h2>

              <p className="mb-6 text-base leading-relaxed font-medium text-gray-300">
                Shape your ideas into stronger prompts before generating.
              </p>

              <div className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-200 transition group-hover:text-white">
                Open Siren&apos;s Mind
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </Link>

          <Link
            href="/generate"
            className="group relative overflow-hidden rounded-[28px] border border-cyan-400/20 bg-gradient-to-br from-cyan-950/20 via-black/50 to-purple-950/30 p-8 backdrop-blur-xl transition-all hover:border-cyan-300/40 hover:bg-white/10"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-blue-500/10 opacity-0 transition-opacity group-hover:opacity-100" />

            <div className="relative">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-500 shadow-lg">
                <Wand2 className="h-8 w-8 text-white" />
              </div>

              <div className="mb-3 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                Direct Creation
              </div>

              <h2 className="mb-3 text-2xl font-bold text-white">
                Generator
              </h2>

              <p className="mb-6 text-base leading-relaxed font-medium text-gray-300">
                Jump straight into creating images with full control.
              </p>

              <div className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-200 transition group-hover:text-white">
                Open Generator
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </Link>

          <Link
            href="/library"
            className="group relative overflow-hidden rounded-[28px] border border-white/15 bg-gradient-to-br from-white/10 to-white/5 p-8 backdrop-blur-xl transition-all hover:border-white/30 hover:bg-white/10"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-cyan-500/10 opacity-0 transition-opacity group-hover:opacity-100" />

            <div className="relative">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-gray-700 to-gray-500 shadow-lg">
                <Library className="h-8 w-8 text-white" />
              </div>

              <div className="mb-3 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                Your Content
              </div>

              <h2 className="mb-3 text-2xl font-bold text-white">
                Vault
              </h2>

              <p className="mb-6 text-base leading-relaxed font-medium text-gray-300">
                Review and reuse your generated content.
              </p>

              <div className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-200 transition group-hover:text-white">
                Open Vault
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </Link>

          <Link
            href="/affiliate"
            className="group relative overflow-hidden rounded-[28px] border border-emerald-400/20 bg-gradient-to-br from-emerald-950/30 via-black/50 to-cyan-950/20 p-8 backdrop-blur-xl transition-all hover:border-emerald-300/40 hover:bg-white/10"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-cyan-500/10 opacity-0 transition-opacity group-hover:opacity-100" />

            <div className="relative">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 shadow-lg">
                <Users className="h-8 w-8 text-white" />
              </div>

              <div className="mb-3 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                Grow & Earn
              </div>

              <h2 className="mb-3 text-2xl font-bold text-white">
                Affiliate Hub
              </h2>

              <p className="mb-6 text-base leading-relaxed font-medium text-gray-300">
                Grab your referral link, track commissions, and grow your reach inside the platform.
              </p>

              <div className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-200 transition group-hover:text-white">
                Open Affiliate Page
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </Link>
        </div>
      </div>
    </main>
  );
}
