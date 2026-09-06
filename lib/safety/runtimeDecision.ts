/**
 * Provider-neutral safety activation contract. This is deliberately not a
 * keyword classifier. Provider/runtime activation must supply authoritative,
 * versioned evidence and only ALLOW may pass an enqueue boundary.
 */
export type RuntimeSafetyDecision={decision:"ALLOW"|"DENY"|"REVIEW"|"UNAVAILABLE";policyVersion:string;decisionId:string;decidedAt:string};
export function assertRuntimeSafetyAllowsEnqueue(value:RuntimeSafetyDecision|null|undefined):void{
 if(!value||value.decision!=="ALLOW"||!value.policyVersion.trim()||!value.decisionId.trim()||!Number.isFinite(Date.parse(value.decidedAt)))throw new Error("RUNTIME_SAFETY_DECISION_REQUIRED");
}
