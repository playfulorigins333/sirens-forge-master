export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { ensureCreatorReadAccess } from "@/lib/creator-read-access";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isPrivateCreatorMediaEnabled, PRIVATE_MEDIA_SIGNED_TTL_SECONDS, sanitizeDownloadFilename, UUID_RE } from "@/lib/private-creator-media/core";
import { signPrivateGenerationObject } from "@/lib/private-creator-media/r2";

export async function GET(req: NextRequest, context: { params: Promise<{ assetId: string }> }) {
  if (!isPrivateCreatorMediaEnabled()) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const auth = await ensureCreatorReadAccess();
  if (!auth.ok) return NextResponse.json({ error: auth.error, message: auth.message }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  const { assetId } = await context.params;
  const mode = req.nextUrl.searchParams.get("mode") ?? "preview";
  if (!UUID_RE.test(assetId) || (mode !== "preview" && mode !== "download")) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("generation_assets")
    .select("id,generation_id,ordinal,kind,lifecycle_state,private_storage_objects!inner(bucket,object_key,mime_type)")
    .eq("id", assetId).eq("owner_id", auth.user.id).in("lifecycle_state", ["active", "trashed"]).maybeSingle();
  if (error) return NextResponse.json({ error: "PRIVATE_MEDIA_NOT_READY" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (!data) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const object = Array.isArray(data.private_storage_objects) ? data.private_storage_objects[0] : data.private_storage_objects;
  if (!object) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const filename = mode === "download" ? sanitizeDownloadFilename(`sirens-forge-${data.generation_id}-${Number(data.ordinal) + 1}`, object.mime_type) : undefined;
    const url = await signPrivateGenerationObject({ bucket: object.bucket, key: object.object_key, filename });
    if (req.nextUrl.searchParams.get("delivery") === "redirect") {
      return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ url, expiresIn: PRIVATE_MEDIA_SIGNED_TTL_SECONDS }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "MEDIA_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
