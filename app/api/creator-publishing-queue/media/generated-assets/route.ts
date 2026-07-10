import { attachGeneratedMediaToCreatorPackage } from "@/lib/creator-publishing-queue/media/generatedMedia"
import { handleGeneratedAssetsPost } from "@/lib/creator-publishing-queue/media/generatedAssetsRouteCore"
export async function POST(request: Request) { return handleGeneratedAssetsPost(request, attachGeneratedMediaToCreatorPackage) }
