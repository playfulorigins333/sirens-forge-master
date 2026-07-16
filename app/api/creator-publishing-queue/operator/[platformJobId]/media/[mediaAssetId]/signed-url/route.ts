import { NextRequest, NextResponse } from "next/server"
import { createOnlyFansOperatorSignedMediaUrl } from "@/lib/creator-publishing-queue/operator-media"

const headers = { "Cache-Control":"private, no-store", Pragma:"no-cache", "Referrer-Policy":"no-referrer", "X-Content-Type-Options":"nosniff" }
function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers }) }
export async function GET(request: NextRequest, { params }: { params: Promise<{ platformJobId: string; mediaAssetId: string }> | { platformJobId: string; mediaAssetId: string } }) {
  if (request.body) return json({ ok:false, code:"invalid_request", message:"Invalid media request." }, 400)
  const url = new URL(request.url)
  if (Array.from(url.searchParams.keys()).some(k => k !== "mode") || url.searchParams.getAll("mode").length !== 1) return json({ ok:false, code:"invalid_request", message:"Invalid media request." }, 400)
  const { platformJobId, mediaAssetId } = await params
  const result = await createOnlyFansOperatorSignedMediaUrl({ platformJobId, mediaAssetId, mode:url.searchParams.get("mode") })
  if (result.ok === false) { const statusByCode = { sign_in_required:401, invalid_request:400, current_claim_required:409, media_unavailable:404, service_unavailable:500 } as const; return json(result, statusByCode[result.code]) }
  return json(result)
}
