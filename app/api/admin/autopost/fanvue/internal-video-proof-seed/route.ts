import { NextResponse } from "next/server"
import { requireUserId } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { createOrReuseFanvueInternalVideoProofSeedAsset, handleFanvueInternalVideoProofSeedRoute } from "@/lib/autopost/fanvueInternalVideoProofSeedAsset"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const response = await handleFanvueInternalVideoProofSeedRoute({
    request: req,
    expectedSecret: process.env.FANVUE_UPLOAD_DIAGNOSTIC_SECRET,
    adminUserIds: process.env.FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_USER_IDS,
    getAuthenticatedUserId: (request) => requireUserId({ request }),
    createSeedAsset: ({ userId }) => createOrReuseFanvueInternalVideoProofSeedAsset({ userId }, { supabaseAdmin: getSupabaseAdmin(), r2Bucket: process.env.R2_BUCKET }),
  })
  return NextResponse.json(response.body, { status: response.status })
}
