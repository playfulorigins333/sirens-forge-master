import { TRUSTED_FACTS_SCHEMA_VERSION, type ComplianceSubmissionApplyResponse, type TrustedComplianceFacts, type TrustedFactsRpcResponse } from "./types"

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hashRe = /^[0-9a-f]{64}$/
const mediaShaRe = /^[0-9a-fA-F]{64}$/
const tsRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
const decRe = /^(0|[1-9]\d*)$/
const platforms = ["onlyfans", "fansly"] as const
const ver = ["verified", "unverified", "revoked", "unattested", "creator_attested"] as const
const consent = ["granted", "revoked", "missing"] as const

function obj(v: unknown): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("invalid object"); return v as Record<string, unknown> }
function str(o: Record<string, unknown>, k: string, nullable = false) { const v = o[k]; if (nullable && v === null) return null; if (typeof v !== "string") throw new Error(`invalid ${k}`); return v }
function bool(o: Record<string, unknown>, k: string) { if (typeof o[k] !== "boolean") throw new Error(`invalid ${k}`); return o[k] as boolean }
function ts(v: unknown, nullable = false) { if (nullable && v === null) return null; if (typeof v !== "string" || !tsRe.test(v)) throw new Error("invalid timestamp"); const d = new Date(v); if (!Number.isFinite(d.getTime())) throw new Error("invalid timestamp"); const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/); if (!m) throw new Error("invalid timestamp"); const [, y, mo, day, h, mi, sec] = m.map(Number) as unknown as number[]; const probe = new Date(Date.UTC(y, mo - 1, day, h, mi, sec)); if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== day || probe.getUTCHours() !== h || probe.getUTCMinutes() !== mi || probe.getUTCSeconds() !== sec) throw new Error("invalid timestamp"); return v }
function uuid(v: unknown) { if (typeof v !== "string" || !uuidRe.test(v)) throw new Error("invalid uuid"); return v }
function one<T extends readonly string[]>(v: unknown, allowed: T) { if (typeof v !== "string" || !allowed.includes(v)) throw new Error("invalid enum"); return v as T[number] }
function nonNegativeInt(v: unknown) { if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new Error("invalid count"); return v }

export const SAFE_CLASSIFICATION_KEYS = ["non_photorealistic", "photorealistic", "lifelike", "deepfake", "face_swap", "unauthorized_face_swap", "third_party_likeness", "ai_background_edit", "ai_outfit_edit", "ai_lighting_edit", "body_adjacent_edit", "upscaled", "creator_likeness_drift", "heavy_alteration", "synthetic_persona", "fictional_persona", "composite_persona", "ai_contribution_more_than_cosmetic", "borderline_lifelike_stylized", "ambiguous_background_people"] as const

export function parseTrustedFactsRpcResponse(data: unknown, expectedCreatorId: string): TrustedFactsRpcResponse {
  if (!uuidRe.test(expectedCreatorId)) throw new Error("invalid creator")
  const r = obj(data)
  if (typeof r.facts_fingerprint !== "string" || !hashRe.test(r.facts_fingerprint)) throw new Error("invalid facts hash")
  if (typeof r.media_manifest_hash !== "string" || !hashRe.test(r.media_manifest_hash)) throw new Error("invalid sql media hash")
  const f = obj(r.facts)
  if (f.schema_version !== TRUSTED_FACTS_SCHEMA_VERSION) throw new Error("invalid schema")
  const p = obj(f.package)
  const pkg = { id: uuid(p.id), creator_id: uuid(p.creator_id), platform_account_id: uuid(p.platform_account_id), target_platform: one(p.target_platform, platforms), title: str(p, "title"), caption_body: str(p, "caption_body"), second_person_present: bool(p, "second_person_present"), creator_approval_status: str(p, "creator_approval_status"), compliance_status: str(p, "compliance_status"), compliance_policy_version: str(p, "compliance_policy_version", true), updated_at: ts(p.updated_at) as string }
  if (pkg.creator_id !== expectedCreatorId) throw new Error("creator mismatch")
  if (pkg.creator_approval_status === "approved") throw new Error("approved")
  const a = obj(f.platform_account)
  const account = { id: uuid(a.id), creator_id: uuid(a.creator_id), platform: one(a.platform, platforms), verification_status: one(a.verification_status, ver), updated_at: ts(a.updated_at, true), is_virtual_entity: bool(a, "is_virtual_entity") }
  if (account.creator_id !== expectedCreatorId || account.id !== pkg.platform_account_id || account.platform !== pkg.target_platform) throw new Error("account mismatch")
  const cv = obj(f.creator_verification)
  const creator_verification = { status: one(cv.status, ver), updated_at: ts(cv.updated_at, true) }
  const c = obj(f.ai_twin_consent)
  const ai_twin_consent = { status: one(c.status, consent), attestation_version: str(c, "attestation_version", true), attestation_text_sha256: str(c, "attestation_text_sha256", true), granted_at: ts(c.granted_at, true), revoked_at: ts(c.revoked_at, true), updated_at: ts(c.updated_at, true) }
  if (!Array.isArray(f.media_manifest) || f.media_manifest.length === 0) throw new Error("media required")
  const mids = new Set<string>(), linked = new Set<string>()
  const media_manifest = f.media_manifest.map((x) => { const m = obj(x); const meta = obj(m.ai_generation_metadata); const id = uuid(m.id); const gid = uuid(meta.generation_id); if (mids.has(id) || linked.has(gid)) throw new Error("duplicate"); mids.add(id); linked.add(gid); if (m.source !== "ai_pipeline") throw new Error("source"); const sha = str(m, "sha256"); if (!mediaShaRe.test(sha)) throw new Error("invalid sha"); return { id, storage_key: str(m, "storage_key"), mime_type: str(m, "mime_type"), sha256: sha.toLowerCase(), source: "ai_pipeline" as const, ai_generation_metadata: { ...meta, generation_id: gid } } })
  if (!Array.isArray(f.generation_manifest)) throw new Error("generation manifest")
  const seenGens = new Set<string>()
  const generation_manifest = f.generation_manifest.map((x) => { const g = obj(x); const gid = uuid(g.generation_id); if (seenGens.has(gid)) throw new Error("duplicate generation"); seenGens.add(gid); const meta = obj(g.safe_classification_metadata); const safe: Record<string, boolean> = {}; for (const k of SAFE_CLASSIFICATION_KEYS) if (meta[k] === true) safe[k] = true; if (g.status !== "completed") throw new Error("not completed"); const bucket = str(g, "r2_bucket"), key = str(g, "r2_key"); if (!bucket.trim() || !key.trim()) throw new Error("r2"); return { generation_id: gid, user_id: uuid(g.user_id), status: "completed" as const, lora_used: str(g, "lora_used", true), job_type: str(g, "job_type", true), body_type: str(g, "body_type", true), mode: str(g, "mode", true), r2_bucket: bucket, r2_key: key, safe_classification_metadata: safe } })
  if (seenGens.size !== linked.size || [...linked].some((gid) => !seenGens.has(gid))) throw new Error("generation set mismatch")
  const co = obj(f.co_performer_summary)
  if (!("human_review_lock" in f)) throw new Error("missing human review lock"); const lock = obj(f.human_review_lock)
  const facts = { schema_version: TRUSTED_FACTS_SCHEMA_VERSION, package: pkg, platform_account: account, creator_verification, ai_twin_consent, media_manifest, generation_manifest, co_performer_summary: { record_count: nonNegativeInt(co.record_count), all_platform_release_confirmed: bool(co, "all_platform_release_confirmed") }, active_queue_task: bool(f, "active_queue_task"), human_review_lock: { locked: bool(lock, "locked"), reason: str(lock, "reason", true), latest_review_id: lock.latest_review_id === null ? null : uuid(lock.latest_review_id), latest_review_outcome: str(lock, "latest_review_outcome", true), latest_review_created_at: ts(lock.latest_review_created_at, true), content_fingerprint: str(lock, "content_fingerprint", true) } } satisfies TrustedComplianceFacts
  if (facts.active_queue_task) throw new Error("locked")
  if (facts.human_review_lock.locked && (!facts.human_review_lock.reason || !["block","manual_review","escalate"].includes(String(facts.human_review_lock.latest_review_outcome)))) throw new Error("invalid human review lock"); if (!facts.human_review_lock.locked && (facts.human_review_lock.reason !== null || facts.human_review_lock.latest_review_id !== null || facts.human_review_lock.latest_review_outcome !== null || facts.human_review_lock.latest_review_created_at !== null)) throw new Error("invalid human review lock"); if (facts.human_review_lock.locked) throw new Error("human review locked")
  return { facts, facts_fingerprint: r.facts_fingerprint as string, media_manifest_hash: r.media_manifest_hash as string }
}

export function parseApplyRpcResponse(data: unknown, expectedCreatorId: string, expectedPackageId: string): ComplianceSubmissionApplyResponse {
  const r = obj(data)
  if (uuid(r.creator_id) !== expectedCreatorId || uuid(r.content_package_id) !== expectedPackageId) throw new Error("mismatch")
  if (!["passed", "manual_review", "blocked"].includes(String(r.resulting_compliance_status))) throw new Error("bad outcome")
  if (typeof r.policy_version !== "string" || r.policy_version.trim() === "" || r.policy_version.length > 120) throw new Error("bad policy")
  const ids = r.audit_event_ids
  if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== "string" || !decRe.test(ids[0])) throw new Error("bad audit")
  if (typeof r.idempotent !== "boolean" || !["evaluated", "idempotent"].includes(String(r.outcome)) || (r.idempotent !== (r.outcome === "idempotent"))) throw new Error("bad idempotent")
  return { content_package_id: r.content_package_id as string, creator_id: r.creator_id as string, prior_compliance_status: typeof r.prior_compliance_status === "string" ? r.prior_compliance_status : null, resulting_compliance_status: r.resulting_compliance_status as any, policy_version: r.policy_version, review_record_id: uuid(r.review_record_id), audit_event_ids: [ids[0]], idempotent: r.idempotent, outcome: r.outcome as any, evaluated_at: ts(r.evaluated_at) as string, updated_at: ts(r.updated_at) as string }
}
