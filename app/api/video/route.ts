import { NextRequest, NextResponse } from "next/server";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { computePriorityForTier } from "@/lib/compute-jobs";
import { parseVideoRequest, parseVideoSubmissionResult } from "@/lib/video/contract";
import { isVideoSubmissionReady } from "@/lib/video/availability";
import { submitVideoProject, VideoSubmissionError } from "@/lib/video/submission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "home";
export const maxDuration = 30;

const VIDEO_GENERATION_UNAVAILABLE_RESPONSE = {
  error: "VIDEO_GENERATION_UNAVAILABLE",
  message: "Video generation is currently unavailable.",
} as const;

const headers = { "Cache-Control": "no-store" };
export async function POST(req: NextRequest) {
  const auth = await ensureActiveSubscription();
  if (!auth.ok || !auth.user) return NextResponse.json({ error: auth.error, message: auth.message }, { status: auth.status, headers });
  if (!isVideoSubmissionReady()) return NextResponse.json(VIDEO_GENERATION_UNAVAILABLE_RESPONSE, { status: 503, headers });
  const key = req.headers.get("Idempotency-Key")?.trim() ?? "";
  if (key.length < 1 || key.length > 128) return NextResponse.json({ error: "INVALID_IDEMPOTENCY_KEY" }, { status: 400, headers });
  const tier = computePriorityForTier(auth.subscription?.tier_name);
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "INVALID_VIDEO_REQUEST" }, { status: 400, headers }); }
  try {
    const request = parseVideoRequest(body, tier);
    const row = await submitVideoProject({ ownerId: auth.user.id, request, idempotencyKey: key, tier });
    const safe = parseVideoSubmissionResult(row);
    if (!safe) return NextResponse.json(VIDEO_GENERATION_UNAVAILABLE_RESPONSE, { status: 503, headers });
    return NextResponse.json(safe, { status: 202, headers });
  } catch (error) {
    if (error instanceof VideoSubmissionError && error.code === "IDEMPOTENCY_CONFLICT") return NextResponse.json({ error: error.code }, { status: 409, headers });
    if (error instanceof VideoSubmissionError && error.code === "VIDEO_SOURCE_INVALID") return NextResponse.json({ error: error.code }, { status: 404, headers });
    if ((error instanceof VideoSubmissionError && error.code === "INVALID_VIDEO_REQUEST") || error instanceof SyntaxError || (error instanceof Error && error.message.startsWith("INVALID_VIDEO"))) return NextResponse.json({ error: "INVALID_VIDEO_REQUEST" }, { status: 400, headers });
    return NextResponse.json(VIDEO_GENERATION_UNAVAILABLE_RESPONSE, { status: 503, headers });
  }
}
