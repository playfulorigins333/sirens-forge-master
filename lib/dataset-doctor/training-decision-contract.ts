import { canonicalUuid } from "@/lib/trainer-application-contract";

export const DATASET_DOCTOR_TRAINING_DECISION_VERSION = "dataset-doctor-training-decision-v1" as const;
export const TRAIN_ANYWAY_DECISION = "train_anyway" as const;
export { DATASET_LIMITS } from "@/lib/dataset-doctor/dataset-limits";

export function canonicalSelectedImageIds(values: unknown[], minimumCount = 1): string[] | null {
  const ids = values.map((value) => canonicalUuid(value && typeof value === "object" ? (value as { image_id?: unknown }).image_id : value)).filter((id): id is string => Boolean(id)).sort();
  return ids.length >= minimumCount && ids.length === values.length && new Set(ids).size === ids.length ? ids : null;
}
