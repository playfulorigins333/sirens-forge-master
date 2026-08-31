import { NextRequest, NextResponse } from "next/server";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { computePriorityForTier } from "@/lib/compute-jobs";
import { parseVideoRequest } from "@/lib/video/contract";
import { isVideoSubmissionReady } from "@/lib/video/availability";
import { submitVideoProject } from "@/lib/video/submission";

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
  try {
    const request = parseVideoRequest(await req.json(), tier);
    const row = await submitVideoProject({ ownerId: auth.user.id, request, idempotencyKey: key, tier });
    return NextResponse.json({ project_id: row.project_id, status: row.creator_status, created_at: row.created_at, can_cancel: row.can_cancel }, { status: 202, headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code.includes("IDEMPOTENCY_CONFLICT")) return NextResponse.json({ error: "IDEMPOTENCY_CONFLICT" }, { status: 409, headers });
    if (code.includes("COMPUTE_POLICY_UNCONFIGURED")) return NextResponse.json(VIDEO_GENERATION_UNAVAILABLE_RESPONSE, { status: 503, headers });
    if (/INVALID|_REQUIRED|_NOT_READY|_TIER_/.test(code)) return NextResponse.json({ error: code.includes("SOURCE") ? "VIDEO_SOURCE_INVALID" : "INVALID_VIDEO_REQUEST" }, { status: code.includes("SOURCE_INVALID") ? 404 : 400, headers });
    return NextResponse.json(VIDEO_GENERATION_UNAVAILABLE_RESPONSE, { status: 503, headers });
  }
}
