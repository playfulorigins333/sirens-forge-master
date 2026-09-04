import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { exportCreatorReplyForProcessingJob, CreatorReplyExportError } from "@/lib/sirens-mind/creator-reply-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function secretMatches(request: Request) {
  const expected = process.env.SIRENS_API_INTERNAL_SECRET?.trim() ?? "";
  const provided = request.headers.get("x-sirens-api-internal-secret")?.trim() ?? "";
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!secretMatches(request)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers: NO_STORE });
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "auth_user_id,export_id") {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers: NO_STORE });
  }
  const exportId = typeof record.export_id === "string" ? record.export_id : "";
  const authUserId = typeof record.auth_user_id === "string" ? record.auth_user_id : "";
  if (!UUID_RE.test(exportId) || !UUID_RE.test(authUserId)) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers: NO_STORE });
  }

  try {
    const creatorReply = await exportCreatorReplyForProcessingJob(exportId, authUserId);
    return NextResponse.json({ creator_reply: creatorReply }, { status: 200, headers: NO_STORE });
  } catch (error) {
    if (error instanceof CreatorReplyExportError) {
      return NextResponse.json({ error: error.code }, { status: error.status, headers: NO_STORE });
    }
    return NextResponse.json({ error: "CREATOR_REPLY_EXPORT_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
  }
}
