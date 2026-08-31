import { NextResponse } from "next/server";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { computePriorityForTier } from "@/lib/compute-jobs";
import { VIDEO_TIERS, VIDEO_TARGET_FPS, VIDEO_TARGET_MIN_SHORT_EDGE } from "@/lib/video/contract";
import { isVideoSubmissionReady } from "@/lib/video/availability";
export const dynamic = "force-dynamic";
export async function GET() { const auth = await ensureActiveSubscription(); const headers={"Cache-Control":"no-store"}; if(!auth.ok) return NextResponse.json({error:auth.error,message:auth.message},{status:auth.status,headers}); const tier=computePriorityForTier(auth.subscription?.tier_name); return NextResponse.json({available:isVideoSubmissionReady(),tier,caps:VIDEO_TIERS[tier],target_fps:VIDEO_TARGET_FPS,target_min_short_edge:VIDEO_TARGET_MIN_SHORT_EDGE},{headers}); }
