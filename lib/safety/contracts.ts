export const SAFETY_CATEGORIES = [
  "GENERAL_COMPLAINT", "CONTENT_REMOVAL", "NCII", "UNAUTHORIZED_INTIMATE_AI",
  "UNDERAGE_EXPLOITATION", "LIKENESS_IDENTITY", "PRIVACY", "COPYRIGHT_DMCA",
  "ACCOUNT_APPEAL", "LEGAL_REGULATORY", "OTHER_SAFETY",
] as const;
export const SAFETY_STATES = [
  "RECEIVED", "TRIAGED", "INFORMATION_NEEDED", "UNDER_REVIEW", "ESCALATED",
  "ACTION_PENDING", "ACTIONED", "NOTIFIED", "APPEAL_OR_COUNTERNOTICE", "CLOSED",
] as const;
export const REPORTER_TYPES = [
  "AFFECTED_PERSON", "AUTHORIZED_REPRESENTATIVE", "PARENT_GUARDIAN", "RIGHTS_HOLDER",
  "ACCOUNT_HOLDER", "ATTORNEY", "LAW_ENFORCEMENT_REGULATOR", "WITNESS_OTHER",
] as const;
export const REASON_CODES = [
  "SAFETY", "UNDERAGE_REPORT", "NONCONSENSUAL", "LIKENESS", "PRIVACY",
  "COPYRIGHT_DMCA", "PLATFORM_POLICY", "ACCOUNT_APPEAL", "LEGAL_PROCESS",
  "INSUFFICIENT_INFORMATION",
] as const;
export type SafetyCategory = typeof SAFETY_CATEGORIES[number];
export function classifySafetyRpcError(message: string | undefined) {
  if ((message ?? "").includes("SAFETY_NOT_FOUND")) return "not_found" as const;
  if (["SAFETY_TRANSITION_INVALID", "SAFETY_CLOSURE_OUTCOME_REQUIRED", "SAFETY_OUTCOME_ONLY_ON_CLOSURE"].some((code) => (message ?? "").includes(code))) return "invalid_transition" as const;
  return "unavailable" as const;
}

export function bounded(value: unknown, min: number, max: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= min && normalized.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : null;
}
export function optionalBounded(value: unknown, max: number) {
  if (value === undefined || value === null || value === "") return null;
  return bounded(value, 1, max);
}
export function validEmail(value: unknown) {
  const normalized = optionalBounded(value, 254);
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}
