import "server-only";
import {
  classifyAutopostFailure,
  validateAdapterPostedProof,
  type AdapterProofInput,
  type FailureClassification,
  type NormalizedAdapterProof,
  type RunProofResultStatus,
} from "@/lib/autopost/jobProof";

type SupabaseUpdateResult = { data?: unknown; error: { message?: string } | null };
type SupabaseUpdateQuery = PromiseLike<SupabaseUpdateResult> & {
  eq: (column: string, value: unknown) => any;
  is: (column: string, value: unknown) => any;
  select: (columns?: string) => any;
  maybeSingle: () => PromiseLike<SupabaseUpdateResult>;
};

type SupabaseWriteClient = {
  from: (table: string) => {
    update: (values: Record<string, unknown>) => SupabaseUpdateQuery;
    insert: (values: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }>;
  };
};

export type PersistableJobResultStatus = Extract<RunProofResultStatus, "POSTED" | "FAILED" | "NOT_CONFIGURED" | "UNSUPPORTED">;
type JobLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
type JobLogInsertOutcome =
  | { ok: true; error_code: null }
  | { ok: false; error_code: "JOB_LOG_PERSIST_FAILED" };

export type JobResultPersistenceInput = {
  job_id: string;
  adapter_result: AdapterProofInput;
  now?: Date;
  attempt_count?: number;
  max_attempts?: number;
};

export type JobResultPersistenceOutcome = {
  ok: boolean;
  job_id: string;
  persisted_status: PersistableJobResultStatus;
  job_result_persisted: boolean;
  audit_log_persisted: boolean;
  audit_log_error_code: "JOB_LOG_PERSIST_FAILED" | null;
  posted: boolean;
  platform_post_id: string | null;
  error_code: string | null;
  retryable: boolean;
  terminal: boolean;
  next_attempt_at: string | null;
  retry_exhausted: boolean;
  attempt_count: number | null;
  max_attempts: number | null;
};

const RESULT_LOG_MESSAGES: Record<PersistableJobResultStatus, string> = {
  POSTED: "job_posted_proof_persisted",
  FAILED: "job_failed",
  NOT_CONFIGURED: "job_not_configured",
  UNSUPPORTED: "job_unsupported",
};

const STABLE_X_RETRY_EXHAUSTION_CODES = new Set([
  "X_API_RATE_LIMITED",
  "X_API_TIMEOUT",
  "X_API_TEMPORARY_FAILURE",
  "ADAPTER_NETWORK_ERROR",
  "INTERNAL_ADAPTER_UNAVAILABLE",
  "X_POST_OUTCOME_UNKNOWN",
  "X_API_UNAUTHORIZED",
  "X_API_FORBIDDEN",
  "X_API_INVALID_REQUEST",
  "X_API_REJECTED",
  "X_ACCOUNT_LOOKUP_FAILED",
  "X_ACCOUNT_NOT_CONNECTED",
  "X_REFRESH_TOKEN_MISSING",
  "X_REFRESH_UNAUTHORIZED",
  "X_TOKEN_EXPIRY_MISSING_AFTER_REFRESH",
  "X_ACCESS_TOKEN_MISSING",
  "X_TOKEN_DECRYPT_FAILED",
  "X_REFRESH_FAILED",
  "X_REFRESH_TOKEN_DECRYPT_FAILED",
  "X_REFRESH_CLIENT_INVALID",
  "X_REFRESH_RESPONSE_INVALID",
  "X_REFRESH_ACCOUNT_UPDATE_FAILED",
  "X_TEXT_TOO_LONG",
  "EMPTY_X_TEXT",
  "X_MEDIA_UNSUPPORTED",
  "TEXT_ONLY_MVP_MEDIA_UNSUPPORTED",
  "CONTENT_PAYLOAD_INVALID",
  "CONTENT_PLATFORM_MISMATCH",
  "CONTENT_TYPE_UNSUPPORTED",
]);

const RETRY_EXHAUSTED_FALLBACK_CODE = "X_RETRY_ATTEMPTS_EXHAUSTED";
const RETRY_EXHAUSTED_SAFE_MESSAGE = "Retry attempts exhausted.";

function safeMessage(message: unknown) {
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 500);
}

function stableRetryExhaustionErrorCode(value: unknown) {
  if (typeof value !== "string") return RETRY_EXHAUSTED_FALLBACK_CODE;
  const trimmed = value.trim();
  return STABLE_X_RETRY_EXHAUSTION_CODES.has(trimmed) ? trimmed : RETRY_EXHAUSTED_FALLBACK_CODE;
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

function normalizeAttemptValue(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizeMaxAttempts(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function buildExhaustionMeta(attemptCount: number, maxAttempts: number) {
  return { retry_exhausted: true, attempt_count: attemptCount, max_attempts: maxAttempts };
}

function buildSafeResultJson(args: {
  status: PersistableJobResultStatus;
  proof?: NormalizedAdapterProof;
  errorCode: string | null;
  safeErrorMessage: string | null;
  exhaustion?: { attempt_count: number; max_attempts: number } | null;
}) {
  return {
    status: args.status,
    platform: args.proof?.platform ?? "x",
    posted: args.proof?.posted ?? false,
    platform_post_id: args.proof?.posted ? args.proof.platform_post_id : null,
    error_code: args.errorCode,
    error_message: args.safeErrorMessage,
    ...(args.exhaustion ? buildExhaustionMeta(args.exhaustion.attempt_count, args.exhaustion.max_attempts) : {}),
  };
}

async function logJobResult(
  supabase: SupabaseWriteClient,
  jobId: string,
  status: PersistableJobResultStatus,
  meta: Record<string, unknown>,
) {
  const resultLevel: JobLogLevel = status === "POSTED" ? "INFO" : "WARN";
  const resultLog = await insertJobLog(supabase, {
    job_id: jobId,
    level: resultLevel,
    message: RESULT_LOG_MESSAGES[status],
    meta,
  });

  const persistedLog = await insertJobLog(supabase, {
    job_id: jobId,
    level: "INFO",
    message: "job_result_persisted",
    meta: {
      result_status: status,
      posted: status === "POSTED",
    },
  });

  return resultLog.ok && persistedLog.ok
    ? ({ ok: true, error_code: null } as const)
    : ({ ok: false, error_code: "JOB_LOG_PERSIST_FAILED" } as const);
}

async function insertJobLog(
  supabase: SupabaseWriteClient,
  values: { job_id: string; level: JobLogLevel; message: string; meta: Record<string, unknown> },
): Promise<JobLogInsertOutcome> {
  try {
    const { error } = await supabase.from("autopost_job_logs").insert(values);
    if (error) return { ok: false, error_code: "JOB_LOG_PERSIST_FAILED" };
    return { ok: true, error_code: null };
  } catch {
    return { ok: false, error_code: "JOB_LOG_PERSIST_FAILED" };
  }
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
  const initialClassification = classifyForPersistence(status, errorCode, now);
  const attemptCount = normalizeAttemptValue(input.attempt_count);
  const maxAttempts = normalizeMaxAttempts(input.max_attempts);
  const retryExhausted =
    status === "FAILED" && initialClassification.retryable && attemptCount !== null && maxAttempts !== null && attemptCount >= maxAttempts;
  const classification = retryExhausted
    ? { retryable: false, terminal: true, next_attempt_at: null, error_code: errorCode ?? "ADAPTER_RESULT_NOT_POSTED" }
    : initialClassification;

  const values = {
    state: status === "POSTED" ? "SUCCEEDED" : classification.retryable ? "QUEUED" : status === "FAILED" ? "FAILED" : "SKIPPED",
    result_status: status,
    result: buildSafeResultJson({
      status,
      proof,
      errorCode,
      safeErrorMessage,
      exhaustion: retryExhausted && attemptCount !== null && maxAttempts !== null ? { attempt_count: attemptCount, max_attempts: maxAttempts } : null,
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
      job_result_persisted: false,
      audit_log_persisted: false,
      audit_log_error_code: null,
      posted: false,
      platform_post_id: null,
      error_code: "JOB_RESULT_PERSIST_FAILED",
      retryable: false,
      terminal: true,
      next_attempt_at: null,
      retry_exhausted: false,
      attempt_count: null,
      max_attempts: null,
    };
  }

  const logOutcome = retryExhausted
    ? await insertJobLog(supabase, {
        job_id: input.job_id,
        level: "WARN",
        message: "job_retry_exhausted",
        meta: { error_code: errorCode, ...buildExhaustionMeta(attemptCount!, maxAttempts!) },
      })
    : await logJobResult(supabase, input.job_id, status, {
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
    job_result_persisted: true,
    audit_log_persisted: logOutcome.ok,
    audit_log_error_code: logOutcome.error_code,
    posted: proof.posted,
    platform_post_id: proof.posted ? proof.platform_post_id : null,
    error_code: errorCode,
    retryable: classification.retryable,
    terminal: classification.terminal,
    next_attempt_at: classification.next_attempt_at,
    retry_exhausted: retryExhausted,
    attempt_count: attemptCount,
    max_attempts: maxAttempts,
  };
}

export async function persistAutopostRetryExhaustion(
  supabase: SupabaseWriteClient,
  input: { job_id: string; now: Date; attempt_count: number; max_attempts: number; error_code?: string | null; error_message?: string | null },
): Promise<JobResultPersistenceOutcome> {
  const attemptCount = normalizeAttemptValue(input.attempt_count);
  const maxAttempts = normalizeMaxAttempts(input.max_attempts);
  const completedAt = input.now.toISOString();
  const errorCode = stableRetryExhaustionErrorCode(input.error_code);
  const safeErrorMessage = RETRY_EXHAUSTED_SAFE_MESSAGE;
  const values = {
    state: "FAILED",
    result_status: "FAILED",
    result: buildSafeResultJson({
      status: "FAILED",
      errorCode,
      safeErrorMessage,
      exhaustion: attemptCount !== null && maxAttempts !== null ? { attempt_count: attemptCount, max_attempts: maxAttempts } : null,
    }),
    error_code: errorCode,
    error_message: safeErrorMessage,
    next_attempt_at: null,
    completed_at: completedAt,
    locked_at: null,
    lock_id: null,
    platform_post_id: null,
    posted_at: null,
  };
  if (attemptCount === null) {
    return { ok: false, job_id: input.job_id, persisted_status: "FAILED", job_result_persisted: false, audit_log_persisted: false, audit_log_error_code: null, posted: false, platform_post_id: null, error_code: "JOB_RESULT_PERSIST_FAILED", retryable: false, terminal: true, next_attempt_at: null, retry_exhausted: false, attempt_count: attemptCount, max_attempts: maxAttempts };
  }

  const { data, error } = await supabase
    .from("autopost_jobs")
    .update(values)
    .eq("id", input.job_id)
    .eq("state", "QUEUED")
    .is("completed_at", null)
    .eq("attempt_count", attemptCount)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, job_id: input.job_id, persisted_status: "FAILED", job_result_persisted: false, audit_log_persisted: false, audit_log_error_code: null, posted: false, platform_post_id: null, error_code: "JOB_RESULT_PERSIST_FAILED", retryable: false, terminal: true, next_attempt_at: null, retry_exhausted: false, attempt_count: attemptCount, max_attempts: maxAttempts };
  }
  const logOutcome = await insertJobLog(supabase, {
    job_id: input.job_id,
    level: "WARN",
    message: "job_retry_exhausted",
    meta: { error_code: errorCode, retry_exhausted: true, attempt_count: attemptCount, max_attempts: maxAttempts },
  });
  return { ok: true, job_id: input.job_id, persisted_status: "FAILED", job_result_persisted: true, audit_log_persisted: logOutcome.ok, audit_log_error_code: logOutcome.error_code, posted: false, platform_post_id: null, error_code: errorCode, retryable: false, terminal: true, next_attempt_at: null, retry_exhausted: true, attempt_count: attemptCount, max_attempts: maxAttempts };
}
