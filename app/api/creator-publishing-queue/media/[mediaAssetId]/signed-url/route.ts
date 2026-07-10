import { NextResponse } from "next/server"
import { createCreatorPublishingSignedMediaUrl, parseCreatorPublishingMediaAccessMode } from "@/lib/creator-publishing-queue/media"

const noStore = { "Cache-Control": "no-store" }

export async function GET(request: Request, { params }: { params: Promise<{ mediaAssetId: string }> | { mediaAssetId: string } }) {
  const { mediaAssetId } = await params
  const mode = parseCreatorPublishingMediaAccessMode(new URL(request.url).searchParams.get("mode") ?? "preview")
  if (!mode) return NextResponse.json({ error: "Invalid mode" }, { status: 400, headers: noStore })
  try {
    const result = await createCreatorPublishingSignedMediaUrl({ mediaAssetId, mode })
    if (!result.ok) { const failure = result as Extract<typeof result, { ok: false }>; return NextResponse.json({ error: failure.code }, { status: failure.status, headers: noStore }) }
    return NextResponse.json(result.value, { status: 200, headers: noStore })
  } catch {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401, headers: noStore })
  }
}
