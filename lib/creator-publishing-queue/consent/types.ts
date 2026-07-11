export type AiTwinConsentDecision = "grant" | "revoke"
export type AiTwinConsentStatus = "granted" | "revoked" | "not_recorded"
export type AiTwinConsentErrorCode = "UNAUTHENTICATED" | "AI_TWIN_CONSENT_INVALID_FORM" | "AI_TWIN_CONSENT_CREATOR_NOT_VERIFIED" | "AI_TWIN_CONSENT_NOT_FOUND" | "AI_TWIN_CONSENT_ALREADY_GRANTED" | "AI_TWIN_CONSENT_ALREADY_REVOKED" | "AI_TWIN_CONSENT_STALE" | "AI_TWIN_CONSENT_IDEMPOTENCY_CONFLICT" | "AI_TWIN_CONSENT_SAVE_FAILED"
export type AiTwinConsentRpcResult = { creator_id:string; prior_status:string|null; resulting_status:"granted"|"revoked"; attestation_version:string; attestation_text_sha256:string; granted_at:string; revoked_at:string|null; updated_at:string; idempotent:boolean; outcome:"granted"|"revoked"|"reattested"|"idempotent"; audit_event_ids:string[] }
export type AiTwinConsentActionInput = { decision: AiTwinConsentDecision; expectedUpdatedAt?: string | null; idempotencyKey: string; confirmGrant?: unknown; confirmRevoke?: unknown; [key: string]: unknown }
export type AiTwinConsentView = { consentStatus: AiTwinConsentStatus; verificationStatus: string; attestationVersion: string|null; grantedAt: string|null; revokedAt: string|null; updatedAt: string|null }
export type AiTwinConsentResult = { ok: true; result: AiTwinConsentRpcResult } | { ok: false; code: AiTwinConsentErrorCode; message: string }
export type AiTwinConsentDeps = { getAuthenticatedUserId(): Promise<string|null>; getAdminClient(): { rpc(name:string, args:Record<string,unknown>): Promise<{ data: unknown; error: { message?: string; code?: string } | null }> } }
