import type { AutopostPlanRequest } from "./types"
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const idem=/^[A-Za-z0-9_-]{8,128}$/
const allowed=new Set(["contentPackageIds","idempotencyKey"])
export const AUTOPOST_PROTECTED_REQUEST_FIELDS=["creatorId","creator_id","platform","targetPlatform","target_platform","platformAccountId","platform_account_id","publishingMode","publishing_mode","capabilities","caption","captionBody","caption_body","aiDisclosure","mediaManifest","generatedMedia","priceNotes","visibilityNotes","complianceStatus","creatorApprovalStatus","workflowState","jobState","sourcePackageUpdatedAt","auditActorId"]
export function normalizeAutopostPlanRequest(input:AutopostPlanRequest){
  for(const key of Object.keys(input)){ if(!allowed.has(key) || AUTOPOST_PROTECTED_REQUEST_FIELDS.includes(key)) throw Object.assign(new Error("Invalid Autopost request"),{code:"AUTOPOST_INVALID_REQUEST"}) }
  if(typeof input.idempotencyKey!=="string" || !idem.test(input.idempotencyKey.trim())) throw Object.assign(new Error("Invalid idempotency key"),{code:"IDEMPOTENCY_CONFLICT"})
  if(!Array.isArray(input.contentPackageIds)) throw Object.assign(new Error("No content packages"),{code:"NO_CONTENT_PACKAGES_SELECTED"})
  const ids=[...new Set(input.contentPackageIds.map(String).map(s=>s.trim().toLowerCase()).filter(Boolean))].sort()
  if(ids.length===0 || ids.some(id=>!uuid.test(id))) throw Object.assign(new Error("No content packages"),{code:"NO_CONTENT_PACKAGES_SELECTED"})
  return { contentPackageIds: ids, idempotencyKey: input.idempotencyKey.trim() }
}
