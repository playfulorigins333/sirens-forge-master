import { createHash } from "node:crypto";
import { canonicalSerialize, canonicalUuid } from "@/lib/trainer-application-contract";

export const DATASET_DOCTOR_TRAINING_DECISION_VERSION = "dataset-doctor-training-decision-v1" as const;
export const TRAIN_ANYWAY_DECISION = "train_anyway" as const;
export { DATASET_LIMITS } from "@/lib/dataset-doctor/dataset-limits";

export { classifyDatasetDoctorQuality, V1_QUALITY_ISSUE_CODES, V1_QUALITY_WARNING_CODES, V1_STRUCTURED_WARNING_TYPES } from "@/lib/dataset-doctor/quality-classification";

const WARNING_FIELDS = ["dataset_quality_score", "dataset_warnings", "dataset_warnings_structured", "primary_issue", "secondary_issues", "priority_guidance", "needs_more_images", "missing_coverage", "composition_summary", "composition_balance", "balance_score", "training_prediction", "confidence_signal", "confidence_message", "dataset_grade"] as const;
const ARRAY_FIELDS = new Set<string>(["dataset_warnings", "dataset_warnings_structured", "secondary_issues", "priority_guidance", "missing_coverage"]);

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize).sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b)));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)]));
  return value ?? null;
}
function stringCodes(value: unknown, allowed: Set<string>, nullable = false): boolean {
  if (nullable && (value === null || value === undefined || value === "")) return true;
  return Array.isArray(value) && value.every((item) => typeof item === "string" && allowed.has(item));
}

export type DatasetDoctorWarningAuthority = { summary: unknown; needs_more_images?: unknown; missing_coverage?: unknown };
export function canonicalWarningSnapshot(authority: DatasetDoctorWarningAuthority | unknown): Record<string, unknown> {
  const wrapped = authority && typeof authority === "object" && !Array.isArray(authority) && "summary" in authority;
  const job = wrapped ? authority as DatasetDoctorWarningAuthority : { summary: authority };
  const source = job.summary && typeof job.summary === "object" && !Array.isArray(job.summary) ? job.summary as Record<string, unknown> : {};
  return Object.fromEntries(WARNING_FIELDS.map((field) => {
    const authoritative = field === "needs_more_images" && job.needs_more_images !== undefined ? job.needs_more_images : field === "missing_coverage" && job.missing_coverage !== undefined ? job.missing_coverage : source[field];
    return [field, ARRAY_FIELDS.has(field) ? normalize(Array.isArray(authoritative) ? authoritative : []) : normalize(authoritative)];
  }));
}
export function sha256Fingerprint(value: unknown): string { return createHash("sha256").update(canonicalSerialize(normalize(value))).digest("hex"); }
export function canonicalSelectedImageIds(values: unknown[], minimumCount = 1): string[] | null {
  const ids = values.map((value) => canonicalUuid(value && typeof value === "object" ? (value as { image_id?: unknown }).image_id : value)).filter((id): id is string => Boolean(id)).sort();
  return ids.length >= minimumCount && ids.length === values.length && new Set(ids).size === ids.length ? ids : null;
}
