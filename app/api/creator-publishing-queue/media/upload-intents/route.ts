import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireUserId } from "@/lib/supabaseServer"
import { createCreatorPublishingMediaUploadIntent } from "@/lib/creator-publishing-queue/media/uploadCore"
const noStore = { "Cache-Control": "no-store" }
export async function POST(request: Request) {
  let creatorId: string
  try { creatorId = await requireUserId({ request }) } catch { return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401, headers: noStore }) }
  try { const result = await createCreatorPublishingMediaUploadIntent(await request.json(), { supabaseAdmin: getSupabaseAdmin(), creatorId })
    if (!result.ok) { const failure = result as Extract<typeof result, { ok: false }>; return NextResponse.json({ error: failure.code }, { status: failure.status, headers: noStore }) }
    return NextResponse.json(result.value, { status: 200, headers: noStore })
  } catch { return NextResponse.json({ error: "UPLOAD_SIGNING_FAILED" }, { status: 500, headers: noStore }) }
}
