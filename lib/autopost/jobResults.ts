import "server-only";
import {
  classifyAutopostFailure,
  validateAdapterPostedProof,
  type AdapterProofInput,
  type FailureClassification,
  type NormalizedAdapterProof,
  type RunProofResultStatus,
} from "@/lib/autopost/jobProof";

type SupabaseWriteClient = {
  from: (table: string) => {
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: string) => PromiseLike<{ error: { message?: string } | null }>;
    };
    insert: (values: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }>;
  };
};

export type PersistableJobResultStatus = Extract<RunProofResultStatus, "POSTED" | "FAILED" | "NOT_CONFIGURED" | "UNSUPPORTED">;

export type JobResultPersistenceInput = {
  job_id: string;
  adapter_result: AdapterProofInput;
  now?: Date;
};

export type JobResultPersistenceOutcome = {
  ok: boolean;
  job_id: string;
  persisted_status: PersistableJobResultStatus;
  posted: boolean;
  platform_post_id: string | null;
  error_code: string | null;
  retryable: boolean;
  terminal: boolean;
  next_attempt_at: string | null;
};

const RESULT_LOG_MESSAGES: Record<PersistableJobResultStatus, string> = {
  POSTED: "job_posted_proof_persisted",
  FAILED: "job_failed",
  NOT_CONFIGURED: "job_not_configured",
  UNSUPPORTED: "job_unsupported",
};

function safeMessage(message: unknown) {
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 500);
}

function normalizeNonPostedStatus(proof: NormalizedAdapterProof): Exclude<PersistableJobResultStatus, "POSTED"> {
  if (proof.result_status === "NOT_CONFIGURED") return "NOT_CONFIGURED";
  if (proof.result_status === "UNSUPPORTED") return "UNSUPPORTED";
  return "FAILED";
}

function classifyForPersistence(status: PersistableJobResultStatus, errorCode: string | null, now: Date): FailureClassification {
  if (status === "POSTED") {
    return {
      retryable: false,
      terminal: true,
      next_attempt_at: null,
      error_code: "POSTED",
    };
  }

  if (status === "NOT_CONFIGURED" || status === "UNSUPPORTED") {
    return {
      retryable: false,
      terminal: true,
      next_attempt_at: null,
      error_code: errorCode ?? status,
    };
  }

  return classifyAutopostFailure(errorCode ?? "ADAPTER_RESULT_NOT_POSTED", now);
}

function buildSafeResultJson(args: {
  status: PersistableJobResultStatus;
  proof: NormalizedAdapterProof;
  errorCode: string | null;
  safeErrorMessage: string | null;
}) {
  return {
    status: args.status,
    platform: args.proof.platform,
    posted: args.proof.posted,
    platform_post_id: args.proof.posted ? args.proof.platform_post_id : null,
    error_code: args.errorCode,
    error_message: args.safeErrorMessage,
  };
}

async function logJobResult(
  supabase: SupabaseWriteClient,
  jobId: string,
  status: PersistableJobResultStatus,
  meta: Record<string, unknown>,
) {
  await supabase.from("autopost_job_logs").insert({
    job_id: jobId,
    level: status === "POSTED" ? "info" : "warn",
    message: RESULT_LOG_MESSAGES[status],
    meta,
  });

  await supabase.from("autopost_job_logs").insert({
    job_id: jobId,
    level: "info",
    message: "job_result_persisted",
    meta: {
      result_status: status,
      posted: status === "POSTED",
    },
  });
}

export async function persistAutopostJobResult(
  supabase: SupabaseWriteClient,
  input: JobResultPersistenceInput,
): Promise<JobResultPersistenceOutcome> {
  const now = input.now ?? new Date();
  const completedAt = now.toISOString();
  const proof = validateAdapterPostedProof(input.adapter_result);
  const status: PersistableJobResultStatus = proof.posted ? "POSTED" : normalizeNonPostedStatus(proof);
  const errorCode = proof.posted ? null : proof.error_code ?? "ADAPTER_RESULT_NOT_POSTED";
  const safeErrorMessage = proof.posted ? null : safeMessage(proof.safe_error_message) ?? "Adapter result was not posted.";
  const classification = classifyForPersistence(status, errorCode, now);

  const values = {
    state: status === "POSTED" ? "SUCCEEDED" : classification.retryable ? "QUEUED" : status === "FAILED" ? "FAILED" : "SKIPPED",
    result_status: status,
    result: buildSafeResultJson({
      status,
      proof,
      errorCode,
      safeErrorMessage,
    }),
    error_code: errorCode,
    error_message: safeErrorMessage,
    platform_post_id: proof.posted ? proof.platform_post_id : null,
    posted_at: proof.posted ? completedAt : null,
    completed_at: classification.terminal ? completedAt : null,
    next_attempt_at: classification.retryable ? classification.next_attempt_at : null,
    locked_at: null,
    lock_id: null,
  };

  const { error } = await supabase.from("autopost_jobs").update(values).eq("id", input.job_id);
  if (error) {
    return {
      ok: false,
      job_id: input.job_id,
      persisted_status: status,
      posted: false,
      platform_post_id: null,
      error_code: "JOB_RESULT_PERSIST_FAILED",
      retryable: false,
      terminal: true,
      next_attempt_at: null,
    };
  }

  await logJobResult(supabase, input.job_id, status, {
    result_status: status,
    retryable: classification.retryable,
    terminal: classification.terminal,
    error_code: errorCode,
    platform_post_id: proof.posted ? proof.platform_post_id : null,
  });

  return {
    ok: true,
    job_id: input.job_id,
    persisted_status: status,
    posted: proof.posted,
    platform_post_id: proof.posted ? proof.platform_post_id : null,
    error_code: errorCode,
    retryable: classification.retryable,
    terminal: classification.terminal,
    next_attempt_at: classification.next_attempt_at,
  };
}
