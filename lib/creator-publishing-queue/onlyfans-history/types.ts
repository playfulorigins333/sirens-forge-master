export type OnlyFansHistoryProvenance = "append_only_audit_evidence" | "immutable_evidence_row_data" | "reconstructed_completion_state" | "derived_lifecycle_event"
export type OnlyFansHistoryAudience = "creator" | "operator"
export type OnlyFansHistoryKind = "lifecycle" | "scheduler" | "operator" | "evidence" | "completion" | "rejection"
export type OnlyFansHistoryEntry = { id:string; kind:OnlyFansHistoryKind; action:string; label:string; explanation:string; occurredAt:string; sortAuditId?:number|null; provenance:OnlyFansHistoryProvenance; evidenceState?:string|null; finalPostUrl?:string|null; noUrlReason?:string|null; metadata?:Record<string,string|number|boolean|null|undefined> }
export type OnlyFansHistorySuccess