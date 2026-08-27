import { createHash } from "node:crypto";
import { canonicalSerialize, canonicalUuid } from "@/lib/trainer-application-contract";

export const DATASET_DOCTOR_TRAINING_DECISION_VERSION = "dataset-doctor-training-decision-v1" as const;
export const TRAIN_ANYWAY_DECISION = "train_anyway" as const;
export { DATASET_LIMITS } from "@/lib/dataset-doctor/dataset-limits";

const WARNING_FIELDS = ["dataset_quality_score", "dataset_warnings", "primary_issue", "secondary_issues", "priority_guidance", "missing_coverage", "needs_more_images", "composition_summary", "composition_balance", "balance_score", "training_prediction", "confidence_signal", "confidence_message", "dataset_grade"] as const;
const ARRAY_FIELDS = new Set<string>(["dataset_warnings", "secondary_issues", "priority_guidance", "missing_coverage"]);
const NON_OVERRIDABLE_CATEGORIES = new Set(["ownership", "binding", "not_exported", "missing_export", "zero_selection", "invalid_file", "unsupported_file", "legal", "safety", "minor", "consent", "system_integrity", "tampered_authority", "non_overridable"]);
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize).sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b)));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)]));
  return value ?? null;
}
export function canonicalWarningSnapshot(summary: unknown): Record<string, unknown> {
  const source = summary && typeof summary === "object" && !Array.isArray(summary) ? summary as Record<string, unknown> : {};
  return Object.fromEntries(WARNING_FIELDS.map((field) => [field, ARRAY_FIELDS.has(field) ? normalize(Array.isArray(source[field]) ? source[field] : []) : normalize(source[field])]));
}
export function sha256Fingerprint(value: unknown): string { return createHash("sha256").update(canonicalSerialize(normalize(value))).digest("hex"); }
export function canonicalSelectedImageIds(rows: Array<{ image_id?: unknown }>): string[] | null {
  const ids = rows.map(({ image_id }) => canonicalUuid(image_id)).filter((id): id is string => Boolean(id)).sort();
  return ids.length > 0 && ids.length === rows.length && new Set(ids).size === ids.length ? ids : null;
}
export function classifyTrainingDecision(summary: unknown, selectedImageCount: number, hasExportReference = true): { overridable: boolean; blockers: string[] } {
  const source = summary && typeof summary === "object" && !Array.isArray(summary) ? summary as Record<string, unknown> : null;
  const raw = source && Array.isArray(source.non_overridable_conditions) ? source.non_overridable_conditions : [];
  const categories = raw.map((item) => typeof item === "string" ? item : item && typeof item === "object" ? String((item as Record<string, unknown>).category || "") : "").filter(Boolean);
  const blockers = categories.filter((value) => NON_OVERRIDABLE_CATEGORIES.has(value));
  if (!source) blockers.push("tampered_authority");
  if (!hasExportReference) blockers.push("missing_export");
  if (selectedImageCount < 1) blockers.push("zero_selection");
  return { overridable: blockers.length === 0 && source?.dataset_ready === false, blockers: [...new Set(blockers)].sort() };
}
