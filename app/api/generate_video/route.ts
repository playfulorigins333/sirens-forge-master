export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "home";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

type VideoMode = "image_to_video" | "text_to_video";

type GenerateVideoRequest = {
  prompt?: string;
  negative_prompt?: string;
  body_mode?: string;
  identity_lora?: string | null;
  mode?: VideoMode;
  image_input?: {
    filename?: string;
    data_url?: string;
  } | null;
  video?: {
    duration?: number;
    fps?: number;
    motion?: number;
    batch?: number;
  } | null;
};

type LoggedGenerationRecord = {
  id?: string;
};

function isVideoMode(value: unknown): value is VideoMode {
  return value === "image_to_video" || value === "text_to_video";
}

function getPlaceholderVideoUrl(req: NextRequest): string {
  const configured =
    process.env.VIDEO_PLACEHOLDER_URL ||
    process.env.NEXT_PUBLIC_VIDEO_PLACEHOLDER_URL ||
    "/videos/placeholder.mp4";

  if (configured.startsWith("http://") || configured.startsWith("https://")) {
    return configured;
  }

  if (configured.startsWith("/")) {
    return new URL(configured, req.nextUrl.origin).toString();
  }

  return new URL(`/${configured}`, req.nextUrl.origin).toString();
}

function getAdminClient() {
  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url || !serviceRole) return null;

  return createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function getUserIdFromCookies(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  if (!url || !anon) return null;

  try {
    const cookieStore = await cookies();

    const supabase = createServerClient(url, anon, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {},
        remove() {},
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    return user?.id ?? null;
  } catch (error) {
    console.warn("[generate_video] Could not resolve authenticated user from cookies.", error);
    return null;
  }
}

async function bestEffortLogGeneration(args: {
  userId: string | null;
  mode: VideoMode;
  prompt: string;
  negativePrompt: string;
  bodyMode: string;
  identityLora: string | null;
  placeholderUrl: string;
  imageInputPresent: boolean;
  video: {
    duration: number;
    fps: number;
    motion: number;
    batch: number;
  };
}): Promise<LoggedGenerationRecord | null> {
  const admin = getAdminClient();
  if (!admin) {
    console.warn("[generate_video] Skipping generation log: SUPABASE_SERVICE_ROLE_KEY missing.");
    return null;
  }

  const now = new Date().toISOString();
  const status = "completed";

  // 🚨 VIDEO IS ALWAYS PLACEHOLDER RIGHT NOW
  const isRealAsset = false;

  const authoritativeLinkedLora =
    isRealAsset &&
    typeof args.identityLora === "string" &&
    args.identityLora.trim().length > 0
      ? args.identityLora.trim()
      : null;

  const metadata = {
    engine: "video-soft-mode",
    template: "sirens_video_placeholder_v1",
    mode: args.mode,
    image_input_present: args.imageInputPresent,
    placeholder: true,
    placeholder_url: args.placeholderUrl,
    video: args.video,
    body_mode: args.bodyMode,
    identity_lora: args.identityLora, // legacy only
    negative_prompt: args.negativePrompt,
    logged_at: now,
  };

  // 🔥 STRICT CONTRACT PAYLOAD (NO FALLBACK INSERT SPAM)
  const payload = {
    user_id: args.userId,
    prompt: args.prompt,
    status,
    kind: "video",
    video_url: null, // NOT a real video yet
    output_url: null,
    lora_used: authoritativeLinkedLora, // always null for now
    metadata,
  };

  const cleaned = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );

  const { data, error } = await admin
    .from("generations")
    .insert(cleaned)
    .select("id")
    .single();

  if (error) {
    console.warn("[generate_video] Could not insert generation record:", error);
    return null;
  }

  return { id: data?.id };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as GenerateVideoRequest;

    const mode: VideoMode = isVideoMode(body.mode) ? body.mode : "text_to_video";
    const prompt = String(body.prompt || "").trim();
    const negativePrompt = String(body.negative_prompt || "").trim();
    const bodyMode = String(body.body_mode || "").trim();
    const identityLora =
      typeof body.identity_lora === "string" && body.identity_lora.trim().length > 0
        ? body.identity_lora.trim()
        : null;

    if (mode === "text_to_video" && !prompt) {
      return NextResponse.json(
        { error: "PROMPT_REQUIRED_FOR_TEXT_TO_VIDEO" },
        { status: 400 }
      );
    }

    if (mode === "image_to_video" && !body.image_input?.data_url) {
      return NextResponse.json(
        { error: "IMAGE_INPUT_REQUIRED_FOR_IMAGE_TO_VIDEO" },
        { status: 400 }
      );
    }

    const video = {
      duration: Math.max(5, Math.min(25, Number(body.video?.duration || 10))),
      fps: Math.max(1, Math.min(60, Number(body.video?.fps || 24))),
      motion: Math.max(0.1, Math.min(1, Number(body.video?.motion || 0.45))),
      batch: Math.max(1, Math.min(4, Number(body.video?.batch || 1))),
    };

    const placeholderUrl = getPlaceholderVideoUrl(req);
    const userId = await getUserIdFromCookies();

    const logged = await bestEffortLogGeneration({
      userId,
      mode,
      prompt,
      negativePrompt,
      bodyMode,
      identityLora,
      placeholderUrl,
      imageInputPresent: Boolean(body.image_input?.data_url),
      video,
    });

    return NextResponse.json(
      {
        status: "ok",
        mode,
        generation_id: logged?.id ?? null,
        video_url: placeholderUrl,
        outputs: [
          {
            kind: "video",
            url: placeholderUrl,
          },
        ],
        placeholder: true,
        message:
          "Video soft mode is active. This placeholder response keeps the generator, logging, and UI flow working until the live video pod is connected.",
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[generate_video] fatal error:", error);

    return NextResponse.json(
      {
        error: "INTERNAL_ERROR",
        message: error?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}