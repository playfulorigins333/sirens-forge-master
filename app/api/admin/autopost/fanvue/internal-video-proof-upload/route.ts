import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/supabaseServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  createOrReuseFanvueInternalVideoProofSeedAsset,
  handleFanvueInternalVideoProofUploadRoute,
} from "@/lib/autopost/fanvueInternalVideoProofSeedAsset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const response = await handleFanvueInternalVideoProofUploadRoute({
    request: req,
    expectedSecret: process.env.FANVUE_UPLOAD_DIAGNOSTIC_SECRET,
    adminUserIds: process.env.FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_USER_IDS,
    getAuthenticatedUserId: (request) => requireUserId({ request }),
    createProofAsset: ({ userId, source }) =>
      createOrReuseFanvueInternalVideoProofSeedAsset(
        { userId, source },
        { supabaseAdmin: getSupabaseAdmin(), r2Bucket: process.env.R2_BUCKET },
      ),
  });
  return NextResponse.json(response.body, { status: response.status });
}
