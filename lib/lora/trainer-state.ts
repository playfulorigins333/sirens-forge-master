export const TRAINER_STATE_ORPHANED = "TRAINER_STATE_ORPHANED";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TrainerStateSource = {
  id?: unknown;
  user_id?: unknown;
  status?: unknown;
  training_job_id?: unknown;
  completed_at?: unknown;
  artifact_r2_bucket?: unknown;
  artifact_r2_key?: unknown;
  error_message?: unknown;
};

export type DurableTrainerJobEvidence = {
  id?: unknown;
  owner_id?: unknown;
  workload?: unknown;
  state?: unknown;
  request_payload?: unknown;
  queued_at?: unknown;
};

const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const canonicalTrainerJobId = (value: unknown): string | null =>
  nonempty(value) && UUID_RE.test(value.trim()) ? value.trim() : null;

export const hasTrainerArtifact = (row: TrainerStateSource): boolean =>
  nonempty(row.artifact_r2_bucket) && nonempty(row.artifact_r2_key);

function requestIdentityId(job: DurableTrainerJobEvidence): string | null {
  const payload = job.request_payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const identityId = (payload as Record<string, unknown>).identity_id;
  return canonicalTrainerJobId(identityId);
}

export function isExactTrainerBinding(
  row: TrainerStateSource,
  job: DurableTrainerJobEvidence | null | undefined,
): job is DurableTrainerJobEvidence {
  const rowId = canonicalTrainerJobId(row.id);
  const ownerId = canonicalTrainerJobId(row.user_id);
  const trainingJobId = canonicalTrainerJobId(row.training_job_id);
  return !!job && !!rowId && !!ownerId && !!trainingJobId
    && canonicalTrainerJobId(job.id) === trainingJobId
    && canonicalTrainerJobId(job.owner_id) === ownerId
    && job.workload === "trainer"
    && requestIdentityId(job) === rowId;
}

function hasTemporallyValidCompletion(row: TrainerStateSource, job: DurableTrainerJobEvidence): boolean {
  if (!hasTrainerArtifact(row) || !nonempty(row.completed_at) || !nonempty(job.queued_at)) return false;
  const completedAt = Date.parse(row.completed_at);
  const queuedAt = Date.parse(job.queued_at);
  return Number.isFinite(completedAt) && Number.isFinite(queuedAt) && completedAt >= queuedAt;
}

function orphaned<T extends TrainerStateSource>(row: T): T & { status: string; error_message?: unknown } {
  return { ...row, status: "failed", error_message: TRAINER_STATE_ORPHANED };
}

/** Projects creator state only from an exact durable Trainer binding or grandfathered artifact evidence. */
export function projectTrainerState<T extends TrainerStateSource>(
  row: T,
  job?: DurableTrainerJobEvidence | null,
): T & { status: string; error_message?: unknown } {
  const persistedStatus = nonempty(row.status) ? row.status.trim().toLowerCase() : "unknown";

  if (isExactTrainerBinding(row, job)) {
    switch (job.state) {
      case "queued":
        return { ...row, status: "queued" };
      case "claimed":
      case "running":
      case "recovering":
      case "cancel_requested":
        return { ...row, status: "training" };
      case "failed":
      case "cancelled":
        return { ...row, status: "failed" };
      case "succeeded":
        return hasTemporallyValidCompletion(row, job)
          ? { ...row, status: "completed" }
          : orphaned(row);
      default:
        return orphaned(row);
    }
  }

  if (persistedStatus === "queued" || persistedStatus === "training") return orphaned(row);
  if (persistedStatus === "completed") {
    return hasTrainerArtifact(row) ? { ...row, status: "completed" } : orphaned(row);
  }
  return { ...row, status: persistedStatus };
}
