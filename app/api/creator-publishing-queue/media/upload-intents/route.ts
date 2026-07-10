import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireUserId } from "@/lib/supabaseServer"
import { createCreatorPublishingMediaUploadIntent } from "@/lib/creator-publishing-queue/media/uploadCore"
const noStore = { "Cache-Control": "no-store" }
function isUnauthenticatedError(error: unknown) { return error instanceof Error && error.message === "Unauthorized" }
export async function POST(request: Request) {
  let creatorId: string
  try { creatorId = await requireUserId({ request }) } catch (error) { return NextResponse.json({ error: isUnauthenticatedError(error) ? "UNAUTHENTICATED" : "UPLOAD_SIGNING_FAILED" }, { status: isUnauthenticatedError(error) ? 401 : 500, headers: noStore }) }
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers: noStore }) }
  try { const result = await createCreatorPublishingMediaUploadIntent(body, { supabaseAdmin: getSupabaseAdmin(), creatorId })
    if (!result.ok) { const failure = result as Extract<typeof result, { ok: false }>; return NextResponse.json({ error: failure.code }, { status: failure.status, headers: noStore }) }
    return NextResponse.json(result.value, { status: 200, headers: noStore })
  } catch { return NextResponse.json({ error: "UPLOAD_SIGNING_FAILED" }, { status: 500, headers: noStore }) }
}
