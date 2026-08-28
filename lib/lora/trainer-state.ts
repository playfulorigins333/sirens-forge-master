export const TRAINER_STATE_ORPHANED = "TRAINER_STATE_ORPHANED";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TrainerStateSource = {
  status?: unknown;
  training_job_id?: unknown;
  artifact_r2_bucket?: unknown;
  artifact_r2_key?: unknown;
  error_message?: unknown;
};

const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const canonicalTrainerJobId = (value: unknown): string | null =>
  nonempty(value) && UUID_RE.test(value.trim()) ? value.trim() : null;

export const hasTrainerArtifact = (row: TrainerStateSource): boolean =>
  nonempty(row.artifact_r2_bucket) && nonempty(row.artifact_r2_key);

/** Projects persisted LoRA state using only creator-safe, durable invariants. */
export function projectTrainerState<T extends TrainerStateSource>(row: T): T & {
  status: string;
  error_message?: unknown;
} {
  const status = nonempty(row.status) ? row.status.trim().toLowerCase() : "unknown";
  const activeWithoutJob = (status === "queued" || status === "training") && !canonicalTrainerJobId(row.training_job_id);
  const completedWithoutArtifact = status === "completed" && !hasTrainerArtifact(row);

  if (activeWithoutJob || completedWithoutArtifact) {
    return { ...row, status: "failed", error_message: TRAINER_STATE_ORPHANED };
  }

  return { ...row, status };
}
