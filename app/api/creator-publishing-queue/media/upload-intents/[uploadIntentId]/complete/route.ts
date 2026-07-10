import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireUserId } from "@/lib/supabaseServer"
import { completeCreatorPublishingMediaUpload } from "@/lib/creator-publishing-queue/media/uploadCore"
const noStore = { "Cache-Control": "no-store" }
function isUnauthenticatedError(error: unknown) { return error instanceof Error && error.message === "Unauthorized" }
export async function POST(request: Request, { params }: { params: Promise<{ uploadIntentId: string }> | { uploadIntentId: string } }) {
  try {
    let creatorId: string
    try { creatorId = await requireUserId({ request }) } catch (error) { return NextResponse.json({ error: isUnauthenticatedError(error) ? "UNAUTHENTICATED" : "ASSET_REGISTRATION_FAILED" }, { status: isUnauthenticatedError(error) ? 401 : 500, headers: noStore }) }
    const { uploadIntentId } = await params
    const result = await completeCreatorPublishingMediaUpload({ uploadIntentId }, { supabaseAdmin: getSupabaseAdmin(), creatorId })
    if (!result.ok) { const failure = result as Extract<typeof result, { ok: false }>; return NextResponse.json({ error: failure.code }, { status: failure.status, headers: noStore }) }
    return NextResponse.json({ mediaAsset: result.value }, { status: 200, headers: noStore })
  } catch { return NextResponse.json({ error: "ASSET_REGISTRATION_FAILED" }, { status: 500, headers: noStore }) }
}
