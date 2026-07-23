import "server-only";

export type AutopostProofPlatform = "x";

export type RunProofResultStatus =
  | "POSTED"
  | "FAILED"
  | "NOT_CONFIGURED"
  | "UNSUPPORTED"
  | "ASSISTED_READY";

export type RunEligibilityRule = {
  approval_state?: string | null;
  enabled?: boolean | null;
  paused_at?: string | null;
  revoked_at?: string | null;
  next_run_at?: string | null;
  selected_platforms?: unknown;
};

export type RunEligibilityResult = {
  eligible: boolean;
  due: boolean;
  platforms: AutopostProofPlatform[];
  error_code: string | null;
};

export type XContentPayloadValidationResult =
  | {
      valid: true;
      text: string;
      metadata: XJobPayloadMetadata;
    }
  | {
      valid: false;
      error_code:
        | "CONTENT_PAYLOAD_INVALID"
        | "CONTENT_PLATFORM_MISMATCH"
        | "CONTENT_TYPE_UNSUPPORTED"
        | "EMPTY_X_TEXT"
        | "X_TEXT_TOO_LONG"
        | "X_MEDIA_UNSUPPORTED";
      safe_error_message: string;
    };

export type XJobPayloadMetadata = {
  source: string | null;
  hashtags: string[];
  generation_ids: string[];
  caption_draft_id: string | null;
  asset_ids: string[];
  asset_urls: string[];
};

export type XJobPayload = {
  platform: "x";
  rule_id: string;
  user_id: string;
  scheduled_for: string;
  text: string;
  metadata: XJobPayloadMetadata;
};

export type AdapterProofInput = {
  ok?: unknown;
  status?: unknown;
  platform?: unknown;
  platform_post_id?: unknown;
  error_code?: unknown;
  error_message?: unknown;
  external_job_id?: unknown;
  workflow_task_id?: unknown;
  ready_for_assisted_posting?: unknown;
};

export type NormalizedAdapterProof = {
  posted: boolean;
  platform: AutopostProofPlatform | null;
  result_status: RunProofResultStatus;
  platform_post_id: string | null;
  error_code: string | null;
  safe_error_message: string | null;
};

export type FailureClassification = {
  retryable: boolean;
  terminal: boolean;
  next_attempt_at: string | null;
  error_code: string;
};

export type ScheduleAdvancementDecision = {
  advance: boolean;
  reason: string;
};

const X_MAX_TEXT_CODE_POINTS = 280;
const DEFAULT_RETRY_DELAY_MS = 5 * 60 * 1000;

const TERMINAL_FAILURE_CODES = new Set([
  "X_ACCOUNT_NOT_CONNECTED",
  "X_REFRESH_TOKEN_MISSING",
  "X_POST_OUTCOME_UNKNOWN",
  "X_REFRESH_UNAUTHORIZED",
  "X_TOKEN_EXPIRY_MISSING_AFTER_REFRESH",
  "X_ACCESS_TOKEN_MISSING",
  "X_TEXT_TOO_LONG",
  "EMPTY_X_TEXT",
  "TEXT_ONLY_MVP_MEDIA_UNSUPPORTED",
  "X_MEDIA_UNSUPPORTED",
  "PLATFORM_NOT_SCHEDULABLE",
  "CONTENT_PAYLOAD_INVALID",
  "CONTENT_PLATFORM_MISMATCH",
  "CONTENT_TYPE_UNSUPPORTED",
]);

const RETRYABLE_FAILURE_CODES = new Set([
  "X_API_RATE_LIMITED",
  "X_API_TIMEOUT",
  "X_API_TEMPORARY_FAILURE",
  "ADAPTER_NETWORK_ERROR",
  "INTERNAL_ADAPTER_UNAVAILABLE",
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function getEligibleRunPlatforms(
  selectedPlatforms: unknown,
  schedulablePlatforms: readonly AutopostProofPlatform[],
): AutopostProofPlatform[] {
  if (!Array.isArray(selectedPlatforms)) return [];

  const schedulable = new Set(schedulablePlatforms);
  return selectedPlatforms.filter(
    (platform): platform is AutopostProofPlatform => platform === "x" && schedulable.has(platform),
  );
}

export function evaluateRunRuleEligibility(
  rule: RunEligibilityRule,
  now: Date,
  schedulablePlatforms: readonly AutopostProofPlatform[],
): RunEligibilityResult {
  if (rule.approval_state !== "APPROVED") {
    return { eligible: false, due: false, platforms: [], error_code: "RULE_NOT_APPROVED" };
  }

  if (rule.enabled !== true) {
    return { eligible: false, due: false, platforms: [], error_code: "RULE_DISABLED" };
  }

  if (rule.paused_at) {
    return { eligible: false, due: false, platforms: [], error_code: "RULE_PAUSED" };
  }

  if (rule.revoked_at) {
    return { eligible: false, due: false, platforms: [], error_code: "RULE_REVOKED" };
  }

  if (!rule.next_run_at) {
    return { eligible: false, due: false, platforms: [], error_code: "NEXT_RUN_AT_MISSING" };
  }

  const nextRunAt = new Date(rule.next_run_at);
  if (Number.isNaN(nextRunAt.getTime())) {
    return { eligible: false, due: false, platforms: [], error_code: "NEXT_RUN_AT_INVALID" };
  }

  if (nextRunAt.getTime() > now.getTime()) {
    return { eligible: false, due: false, platforms: [], error_code: "RULE_NOT_DUE" };
  }

  const platforms = getEligibleRunPlatforms(rule.selected_platforms, schedulablePlatforms);
  if (platforms.length === 0) {
    return { eligible: false, due: true, platforms: [], error_code: "PLATFORM_NOT_SCHEDULABLE" };
  }

  return { eligible: true, due: true, platforms, error_code: null };
}

export function validateXRunContentPayload(contentPayload: unknown): XContentPayloadValidationResult {
  const payload = asRecord(contentPayload);
  if (!payload) {
    return { valid: false, error_code: "CONTENT_PAYLOAD_INVALID", safe_error_message: "Content payload is invalid." };
  }

  if (payload.platform !== "x") {
    return { valid: false, error_code: "CONTENT_PLATFORM_MISMATCH", safe_error_message: "Content payload platform must be x." };
  }

  if (payload.content_type !== "text") {
    return { valid: false, error_code: "CONTENT_TYPE_UNSUPPORTED", safe_error_message: "Only text content is supported for X MVP posting." };
  }

  if (payload.media_posting_enabled !== false) {
    return { valid: false, error_code: "X_MEDIA_UNSUPPORTED", safe_error_message: "Media posting is not supported for X text-only MVP." };
  }

  const text = optionalString(payload.text);
  if (!text) {
    return { valid: false, error_code: "EMPTY_X_TEXT", safe_error_message: "X text content is required." };
  }

  // X uses weighted character counting. The MVP proof layer intentionally uses
  // Unicode code points only until exact weighted counting is added before launch.
  if ([...text].length > X_MAX_TEXT_CODE_POINTS) {
    return { valid: false, error_code: "X_TEXT_TOO_LONG", safe_error_message: "X text content exceeds 280 characters." };
  }

  const assetIds = stringArray(payload.asset_ids);
  const assetUrls = stringArray(payload.asset_urls);
  if (assetIds.length > 0 || assetUrls.length > 0) {
    return { valid: false, error_code: "X_MEDIA_UNSUPPORTED", safe_error_message: "X text-only MVP jobs cannot require media assets." };
  }

  return {
    valid: true,
    text,
    metadata: {
      source: optionalString(payload.source),
      hashtags: stringArray(payload.hashtags),
      generation_ids: stringArray(payload.generation_ids),
      caption_draft_id: optionalString(payload.caption_draft_id),
      asset_ids: assetIds,
      asset_urls: assetUrls,
    },
  };
}

export function buildXAutopostJobPayload(args: {
  rule_id: string;
  user_id: string;
  scheduled_for: string;
  text: string;
  metadata?: Partial<XJobPayloadMetadata>;
}): XJobPayload {
  return {
    platform: "x",
    rule_id: args.rule_id,
    user_id: args.user_id,
    scheduled_for: args.scheduled_for,
    text: args.text,
    metadata: {
      source: args.metadata?.source ?? null,
      hashtags: args.metadata?.hashtags ?? [],
      generation_ids: args.metadata?.generation_ids ?? [],
      caption_draft_id: args.metadata?.caption_draft_id ?? null,
      asset_ids: args.metadata?.asset_ids ?? [],
      asset_urls: args.metadata?.asset_urls ?? [],
    },
  };
}

export function validateAdapterPostedProof(result: AdapterProofInput): NormalizedAdapterProof {
  // POSTED requires real provider proof. ASSISTED_READY, external_job_id,
  // workflow_task_id, ready_for_assisted_posting, and webhook ok:true are not proof.
  if (result.status === "ASSISTED_READY" || result.ready_for_assisted_posting || result.workflow_task_id) {
    return {
      posted: false,
      platform: result.platform === "x" ? "x" : null,
      result_status: "ASSISTED_READY",
      platform_post_id: null,
      error_code: "ASSISTED_READY_NOT_POSTED",
      safe_error_message: "Assisted posting readiness is not a posted result.",
    };
  }

  if (result.ok === true && result.status === "POSTED" && result.platform === "x" && isNonEmptyString(result.platform_post_id)) {
    return {
      posted: true,
      platform: "x",
      result_status: "POSTED",
      platform_post_id: result.platform_post_id.trim(),
      error_code: null,
      safe_error_message: null,
    };
  }

  const status = result.status === "NOT_CONFIGURED" || result.status === "UNSUPPORTED" ? result.status : "FAILED";
  const errorCode = optionalString(result.error_code) ?? (result.ok === true ? "POSTED_PROOF_MISSING" : "ADAPTER_RESULT_NOT_POSTED");

  return {
    posted: false,
    platform: result.platform === "x" ? "x" : null,
    result_status: status,
    platform_post_id: null,
    error_code: errorCode,
    safe_error_message: optionalString(result.error_message) ?? "Adapter result did not include verified posted proof.",
  };
}

export function classifyAutopostFailure(errorCode: string, now: Date, retryDelayMs = DEFAULT_RETRY_DELAY_MS): FailureClassification {
  const normalizedCode = errorCode.trim() || "UNKNOWN_AUTOPOST_ERROR";

  if (RETRYABLE_FAILURE_CODES.has(normalizedCode)) {
    return {
      retryable: true,
      terminal: false,
      next_attempt_at: new Date(now.getTime() + retryDelayMs).toISOString(),
      error_code: normalizedCode,
    };
  }

  if (TERMINAL_FAILURE_CODES.has(normalizedCode)) {
    return {
      retryable: false,
      terminal: true,
      next_attempt_at: null,
      error_code: normalizedCode,
    };
  }

  return {
    retryable: false,
    terminal: true,
    next_attempt_at: null,
    error_code: normalizedCode,
  };
}

export function shouldAdvanceScheduleAfterProof(requiredPlatforms: readonly AutopostProofPlatform[], proofs: readonly NormalizedAdapterProof[]): ScheduleAdvancementDecision {
  // Schedule advancement must happen only after verified POSTED proof. Job creation,
  // locking, dispatch start, retry-pending states, ASSISTED_READY, and ok:true
  // without platform_post_id never advance the rule schedule.
  if (requiredPlatforms.length === 0) {
    return { advance: false, reason: "NO_REQUIRED_PLATFORMS" };
  }

  for (const platform of requiredPlatforms) {
    const proof = proofs.find(
      (candidate) => candidate.platform === platform && candidate.result_status === "POSTED" && candidate.platform_post_id,
    );
    if (!proof?.posted) {
      return { advance: false, reason: "POSTED_PROOF_MISSING" };
    }
  }

  return { advance: true, reason: "ALL_REQUIRED_PLATFORMS_POSTED" };
}
