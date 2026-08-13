import { ensureActiveSubscription } from "@/lib/subscription-checker"
import { NextResponse } from "next/server"
import { attachGeneratedMediaToCreatorPackage } from "@/lib/creator-publishing-queue/media/generatedMedia"
import { handleGeneratedAssetsPost } from "@/lib/creator-publishing-queue/media/generatedAssetsRouteCore"

export async function POST(request: Request) {
  const auth = await ensureActiveSubscription()
  if (!auth.ok || !auth.user?.id) return NextResponse.json({ error: auth.error ?? "SUBSCRIPTION_REQUIRED" }, { status: auth.status ?? 403, headers: { "Cache-Control": "no-store" } })
  return handleGeneratedAssetsPost(request, (input) => attachGeneratedMediaToCreatorPackage(input, {
    getCreatorIdentity: async () => ({ authUserId: auth.user!.id, profileId: auth.profile?.id ?? null }),
  }))
}
