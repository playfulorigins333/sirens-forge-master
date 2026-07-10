import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireUserId } from "@/lib/supabaseServer"
import { completeCreatorPublishingMediaUpload } from "@/lib/creator-publishing-queue/media/uploadCore"
const noStore = { "Cache-Control": "no-store" }
export async function POST(request: Request, { params }: { params: Promise<{ uploadIntentId: string }> | { uploadIntentId: string } }) {
  let creatorId: string
  try { creatorId = await requireUserId({ request }) } catch { return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401, headers: noStore }) }
  const { uploadIntentId } = await params
  const result = await completeCreatorPublishingMediaUpload({ uploadIntentId }, { supabaseAdmin: getSupabaseAdmin(), creatorId })
  if (!result.ok) { const failure = result as Extract<typeof result, { ok: false }>; return NextResponse.json({ error: failure.code }, { status: failure.status, headers: noStore }) }
  return NextResponse.json({ mediaAsset: result.value }, { status: 200, headers: noStore })
}
