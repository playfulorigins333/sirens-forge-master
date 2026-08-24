import "server-only"
import { notFound } from "next/navigation"
import { getSupabaseAdmin } from "../../supabaseAdmin"
import { requireActiveCreatorPageIdentity } from "../creatorEntitlement"
import { createCreatorPublishingSignedMediaUrl } from "../media"
import {
  isEligibleGeneratedMediaRecord,
  resolveGeneratedMediaKind,
  resolveGeneratedMediaPreviewUrl,
} from "../media/generatedMediaEligibility"
import { isPrivateCreatorMediaEnabled } from "../../private-creator-media/core"

export type FanvuePackageGeneratedMediaCandidate = {
  candidateId: string
  generationId: string
  generationAssetId: string | null
  ordinal: number | null
  kind: "image" | "video"
  previewUrl: string
  promptExcerpt: string
  createdAt: string | null
  mode: string | null
  alreadyAttached: boolean
}

export type FanvuePackageMediaAsset = {
  id: string
  mimeType: string
  sha256: string
  signedUrl: string | null
}

export type FanvuePackageMediaView = {
  pkg: {
    id: string
    title: string
    creatorApprovalStatus: string
    updatedAt: string
  }
  media: FanvuePackageMediaAsset[]
  generatedMediaCandidates: FanvuePackageGeneratedMediaCandidate[]
  generatedMediaSelectionAllowed: boolean
  generatedMediaSelectionBlockedReason: string | null
}

function promptExcerpt(prompt: unknown): string {
  const text = typeof prompt === "string" ? prompt.replace(/\s+/g, " ").trim() : ""
  return text.length > 140 ? `${text.slice(0, 137)}…` : text
}

export async function loadCreatorFanvuePackageMedia(
  contentPackageId: string,
): Promise<FanvuePackageMediaView> {
  const identity = await requireActiveCreatorPageIdentity()
  const creatorId = identity.authUserId
  const generationOwnerIds = [creatorId, identity.profileId].filter(
    (value): value is string => Boolean(value),
  )
  const admin = getSupabaseAdmin()

  const { data: pkg, error: packageError } = await admin
    .from("creator_publishing_content_packages")
    .select("id,creator_id,target_platform,title,creator_approval_status,updated_at")
    .eq("id", contentPackageId)
    .eq("creator_id", creatorId)
    .eq("target_platform", "fanvue")
    .maybeSingle()

  if (packageError) throw new Error("Fanvue package could not be loaded.")
  if (!pkg) notFound()

  const [mediaResult, taskResult, generationsResult] = await Promise.all([
    admin
      .from("creator_publishing_media_assets")
      .select("id,storage_key,mime_type,sha256,source,ai_generation_metadata,created_at")
      .eq("content_package_id", contentPackageId)
      .order("id", { ascending: true }),
    admin
      .from("creator_publishing_queue_tasks")
      .select("id,status")
      .eq("content_package_id", contentPackageId)
      .neq("status", "archived")
      .limit(1),
    admin
      .from("generations")
      .select("id,user_id,status,prompt,image_url,mode,body_type,job_type,created_at,r2_bucket,r2_key,metadata")
      .in("user_id", generationOwnerIds)
      .eq("status", "completed")
      .not("r2_bucket", "is", null)
      .not("r2_key", "is", null)
      .order("created_at", { ascending: false })
      .limit(80),
  ])

  if (mediaResult.error) throw new Error("Fanvue package media could not be loaded.")
  if (taskResult.error) throw new Error("Fanvue package lock state could not be loaded.")
  if (generationsResult.error) throw new Error("Generated media candidates could not be loaded.")

  const privateResult = isPrivateCreatorMediaEnabled()
    ? await admin.from("generation_assets").select("id,generation_id,ordinal,kind,created_at,generations!inner(id,user_id,status,prompt,mode,created_at,metadata)").eq("owner_id", creatorId).order("created_at", { ascending: false }).limit(320)
    : { data: [], error: null }
  if (privateResult.error) throw new Error("Private creator media schema is unavailable while enabled.")

  const mediaRows = mediaResult.data ?? []
  const attachedGenerationIds = new Set(
    mediaRows
      .filter(
        (row: any) =>
          row.source === "ai_pipeline" &&
          typeof row.ai_generation_metadata?.generation_id === "string",
      )
      .map((row: any) => row.ai_generation_metadata.generation_id),
  )
  const attachedGenerationAssetIds = new Set(mediaRows.filter((row:any) => row.source === "ai_pipeline" && typeof row.ai_generation_metadata?.generation_asset_id === "string").map((row:any) => row.ai_generation_metadata.generation_asset_id))

  const generatedMediaCandidates = (generationsResult.data ?? [])
    .filter(
      (generation: any) =>
        generationOwnerIds.includes(generation.user_id) &&
        isEligibleGeneratedMediaRecord(generation) &&
        Boolean(resolveGeneratedMediaPreviewUrl(generation)),
    )
    .map((generation: any): FanvuePackageGeneratedMediaCandidate => {
      const previewUrl = resolveGeneratedMediaPreviewUrl(generation)!
      return {
        candidateId: `generation:${generation.id}`,
        generationId: generation.id,
        generationAssetId: null,
        ordinal: null,
        kind: resolveGeneratedMediaKind(generation, previewUrl),
        previewUrl,
        promptExcerpt: promptExcerpt(generation.prompt),
        createdAt: generation.created_at ?? null,
        mode: generation.mode ?? null,
        alreadyAttached: attachedGenerationIds.has(generation.id),
      }
    })

  const privateCandidates: FanvuePackageGeneratedMediaCandidate[] = (privateResult.data ?? []).flatMap((asset:any) => {
    const generation = Array.isArray(asset.generations) ? asset.generations[0] : asset.generations
    if (!generation || generation.user_id !== creatorId || generation.status !== "completed" || generation.metadata?.private_creator_media !== true) return []
    return [{ candidateId:`asset:${asset.id}`, generationId:generation.id, generationAssetId:asset.id, ordinal:asset.ordinal, kind:asset.kind, previewUrl:`/api/library/assets/${asset.id}/signed-url?mode=preview&delivery=redirect`, promptExcerpt:promptExcerpt(generation.prompt), createdAt:asset.created_at ?? generation.created_at ?? null, mode:generation.mode ?? null, alreadyAttached:attachedGenerationAssetIds.has(asset.id) }]
  })

  const media = await Promise.all(
    mediaRows.map(async (row: any): Promise<FanvuePackageMediaAsset> => {
      const signed = await createCreatorPublishingSignedMediaUrl({
        mediaAssetId: row.id,
        mode: "preview",
        authenticatedCreatorId: creatorId,
      })
      return {
        id: row.id,
        mimeType: row.mime_type,
        sha256: row.sha256,
        signedUrl: signed.ok ? signed.value.signedUrl : null,
      }
    }),
  )

  const activeTask = (taskResult.data ?? []).length > 0
  const approved = pkg.creator_approval_status === "approved"
  const blockedReason = approved
    ? "This package is already approved, so media cannot be changed."
    : activeTask
      ? "This package has an active publishing task, so media cannot be changed."
      : null

  return {
    pkg: {
      id: pkg.id,
      title: pkg.title,
      creatorApprovalStatus: pkg.creator_approval_status,
      updatedAt: pkg.updated_at,
    },
    media,
    generatedMediaCandidates: [...privateCandidates, ...generatedMediaCandidates.filter((legacy) => !privateCandidates.some((candidate) => candidate.generationId === legacy.generationId))],
    generatedMediaSelectionAllowed: blockedReason == null,
    generatedMediaSelectionBlockedReason: blockedReason,
  }
}
