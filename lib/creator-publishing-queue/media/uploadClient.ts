import { supabaseBrowser } from "@/lib/supabase"
import { CREATOR_PUBLISHING_MEDIA_EXTENSION_BY_MIME, CREATOR_PUBLISHING_MEDIA_MAX_UPLOAD_BYTES, type CreatorPublishingUploadSource, type RegisteredMediaAsset } from "./uploadShared"

async function sha256Hex(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")
}
export async function uploadCreatorPublishingMediaFile(input: { file: File; contentPackageId: string; source: CreatorPublishingUploadSource }): Promise<RegisteredMediaAsset> {
  if (!CREATOR_PUBLISHING_MEDIA_EXTENSION_BY_MIME[input.file.type]) throw new Error("INVALID_MIME_TYPE")
  if (input.file.size <= 0 || input.file.size > CREATOR_PUBLISHING_MEDIA_MAX_UPLOAD_BYTES) throw new Error("INVALID_FILE_SIZE")
  const sha256 = await sha256Hex(input.file)
  const intentResponse = await fetch("/api/creator-publishing-queue/media/upload-intents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentPackageId: input.contentPackageId, mimeType: input.file.type, sizeBytes: input.file.size, sha256, source: input.source }) })
  if (!intentResponse.ok) throw new Error((await intentResponse.json()).error ?? "UPLOAD_SIGNING_FAILED")
  const intent = await intentResponse.json()
  const supabase = supabaseBrowser()
  const uploaded = await supabase.storage.from(intent.bucket).uploadToSignedUrl(intent.storageKey, intent.token, input.file)
  if (uploaded.error) throw new Error("UPLOAD_METADATA_MISMATCH")
  const completeResponse = await fetch(`/api/creator-publishing-queue/media/upload-intents/${intent.uploadIntentId}/complete`, { method: "POST" })
  if (!completeResponse.ok) throw new Error((await completeResponse.json()).error ?? "ASSET_REGISTRATION_FAILED")
  return (await completeResponse.json()).mediaAsset
}
