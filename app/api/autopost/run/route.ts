// app/api/autopost/run/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import {
  buildXAutopostJobPayload,
  evaluateRunRuleEligibility,
  validateXRunContentPayload,
  type AutopostProofPlatform,
} from "@/lib/autopost/jobProof";
import { persistAutopostJobResult, persistAutopostRetryExhaustion } from "@/lib/autopost/jobResults";
import { calculateNextRunAtAfterPostedProof } from "@/lib/autopost/scheduleAdvance";
import { postXTextOnlyAutopost } from "@/lib/autopost/xAdapter";
import { runFanvueRouteDryRunVerification, isFanvueRouteDryRunConfirmed } from "@/lib/autopost/fanvueRunRouteDryRunVerifier";
// Fanvue route dry-run verification delegates to runFanvueDryRunBranch without live dispatch.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ============================================================
 * AUTOPOST JOB FOUNDATION RUNNER (GATED DISPATCH)
 * ============================================================
 *
 * Normal cron invocations remain limited to job creation/dedupe/locking
 * foundation work. The explicit internal dispatch gate may call the X adapter,
 * persist strict POSTED proof, and advance schedules only after persisted
 * provider proof with a real platform_post_id.
 */

/* ──────────────────────────────────────────────
   Env / Clients
────────────────────────────────────────────── */
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const CRON_SECRET = process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET || "";
const LOCK_TTL_MS = 15 * 60 * 1000;
const MAX_X_DISPATCH_ATTEMPTS = 3;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type AutopostRunDbClient = typeof supabaseAdmin;
type ExecuteAutopostDeps = {
  supabaseAdmin?: AutopostRunDbClient;
  cronSecret?: string;
  env?: Record<string, string | undefined>;
  postXTextOnlyAutopost?: typeof postXTextOnlyAutopost;
  now?: () => Date;
};

/* ──────────────────────────────────────────────
   Types
────────────────────────────────────────────── */
type AutopostRuleForJobs = {
  id: string;
  user_id: string;
  approval_state: string;
  enabled: boolean;
  selected_platforms: unknown;
  next_run_at: string | null;
  timezone: string | null;
  start_date: string | null;
  end_date: string | null;
  posts_per_day: number | null;
  time_slots: unknown;
  paused_at: string | null;
  revoked_at: string | null;
  content_payload: unknown;
};

type AutopostJobRow = {
  id: string;
  attempt_count: number | null;
  locked_at: string | null;
  lock_id: string | null;
  state: string | null;
  next_attempt_at: string | null;
  completed_at: string | null;
  result_status: string | null;
  error_code: string | null;
  error_message: string | null;
};

type RunSummary = {
  mode: "job_foundation_no_dispatch";
  scanned: number;
  eligible_rules: number;
  jobs_created: number;
  jobs_existing: number;
  jobs_found: number;
  jobs_locked: number;
  job_lock_skipped: number;
  skipped: number;
  dispatches_attempted: number;
  posts_attempted: number;
  results_posted: number;
  results_failed: number;
  result_persistence_failures: number;
  job_log_persistence_failures: number;
  results_not_configured: number;
  results_unsupported: number;
  schedule_advancements: number;
  schedule_advancement_skipped: number;
  fanvue_dry_runs: number;
  fanvue_dry_run_blocked: number;
  retry_not_due: number;
  retry_exhausted: number;
  terminal_jobs_skipped: number;
  currently_locked: number;
  lock_eligibility_changed: number;
  lock_mode: "foundation_no_dispatch" | "dispatch_gate";
};

type JobLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
type RunnerLogOutcome =
  | { ok: true; error_code: null }
  | { ok: false; error_code: "JOB_LOG_PERSIST_FAILED" };

/* ──────────────────────────────────────────────
   Helpers
────────────────────────────────────────────── */
function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function isDuplicateError(error: { code?: string | null } | null) {
  return error?.code === "23505";
}

function getFoundationSchedulablePlatforms(req: Request): AutopostProofPlatform[] {
  const url = new URL(req.url);

  // X remains non-selectable/non-schedulable publicly. The explicit foundation
  // flag only allows this protected cron route to create non-dispatch PENDING
  // job rows for future X run work; it never posts or advances schedules.
  if (url.searchParams.get("foundation") === "1") {
    return ["x"];
  }

  return [];
}

function shouldClaimJobs(req: Request) {
  return new URL(req.url).searchParams.get("claim") === "1";
}

function isDispatchGateEnabled(req: Request, env: Record<string, string | undefined> = process.env) {
  const url = new URL(req.url);
  const requested = url.searchParams.get("dispatch") === "1" || url.searchParams.get("execute") === "1";
  return requested && env.AUTOPOST_X_RUN_DISPATCH_ENABLED === "true";
}

function getFanvueDryRunConfirmation(req: Request) {
  return new URL(req.url).searchParams.get("fanvue_dry_run_confirm") || "";
}

/* ──────────────────────────────────────────────
   Cron Auth
────────────────────────────────────────────── */
function assertCronAuth(req: Request, cronSecret = CRON_SECRET) {
  if (!cronSecret) {
    return { ok: false as const, error: "CRON_SECRET_NOT_CONFIGURED" };
  }

  const auth = req.headers.get("authorization") || "";
  const xCron = req.headers.get("x-vercel-cron-secret") || "";

  if (auth === `Bearer ${cronSecret}`) return { ok: true as const };
  if (xCron === cronSecret) return { ok: true as const };

  return { ok: false as const, error: "UNAUTHORIZED" };
}

/* ──────────────────────────────────────────────
   DB Helpers
────────────────────────────────────────────── */
async function logJobEvent(
  db: AutopostRunDbClient,
  jobId: string,
  message: string,
  meta: Record<string, unknown> = {},
  level: JobLogLevel = "INFO",
): Promise<RunnerLogOutcome> {
  try {
    const { error } = await db.from("autopost_job_logs").insert({
      job_id: jobId,
      level,
      message,
      meta,
    });
    if (error) return { ok: false, error_code: "JOB_LOG_PERSIST_FAILED" };
    return { ok: true, error_code: null };
  } catch {
    return { ok: false, error_code: "JOB_LOG_PERSIST_FAILED" };
  }
}

async function advanceScheduleAfterPostedProof(db: AutopostRunDbClient, args: {
  rule: AutopostRuleForJobs;
  jobId: string;
  scheduledFor: string;
  now: Date;
}) {
  const { data: persistedJob, error } = await db
    .from("autopost_jobs")
    .select("id,rule_id,user_id,platform,scheduled_for,result_status,platform_post_id")
    .eq("id", args.jobId)
    .maybeSingle();

  if (error) throw error;

  if (
    !persistedJob ||
    persistedJob.rule_id !== args.rule.id ||
    persistedJob.user_id !== args.rule.user_id ||
    persistedJob.platform !== "x" ||
    persistedJob.scheduled_for !== args.scheduledFor ||
    persistedJob.result_status !== "POSTED" ||
    typeof persistedJob.platform_post_id !== "string" ||
    persistedJob.platform_post_id.trim() === ""
  ) {
    const log = await logJobEvent(db, args.jobId, "schedule_advancement_skipped", {
      reason: "POSTED_PROOF_NOT_PERSISTED_FOR_SLOT",
      rule_id: args.rule.id,
      platform: "x",
      scheduled_for: args.scheduledFor,
    }, "WARN");
    return { advanced: false, skipped: true, reason: "POSTED_PROOF_NOT_PERSISTED_FOR_SLOT", log };
  }

  const nextRun = calculateNextRunAtAfterPostedProof({
    rule: args.rule,
    scheduled_for: args.scheduledFor,
    now: args.now,
  });

  if (nextRun.ok === false) {
    const log = await logJobEvent(db, args.jobId, "schedule_advancement_skipped", {
      reason: nextRun.error_code,
      rule_id: args.rule.id,
      platform: "x",
      scheduled_for: args.scheduledFor,
    }, "WARN");
    return { advanced: false, skipped: true, reason: nextRun.error_code, log };
  }

  const { data: updatedRule, error: updateError } = await db
    .from("autopost_rules")
    .update({
      last_run_at: args.now.toISOString(),
      next_run_at: nextRun.next_run_at,
    })
    .eq("id", args.rule.id)
    .eq("user_id", args.rule.user_id)
    .eq("approval_state", "APPROVED")
    .eq("enabled", true)
    .is("paused_at", null)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (updateError) throw updateError;

  if (!updatedRule) {
    const log = await logJobEvent(db, args.jobId, "schedule_advancement_skipped", {
      reason: "RULE_NOT_ADVANCEABLE",
      rule_id: args.rule.id,
      platform: "x",
      scheduled_for: args.scheduledFor,
    }, "WARN");
    return { advanced: false, skipped: true, reason: "RULE_NOT_ADVANCEABLE", log };
  }

  const log = await logJobEvent(db, args.jobId, "schedule_advanced", {
    rule_id: args.rule.id,
    platform: "x",
    scheduled_for: args.scheduledFor,
    next_run_at: nextRun.next_run_at,
    reason: nextRun.reason,
  });

  return { advanced: true, skipped: false, next_run_at: nextRun.next_run_at, log };
}

async function findExistingJob(db: AutopostRunDbClient, ruleId: string, platform: AutopostProofPlatform, scheduledFor: string) {
  const { data, error } = await db
    .from("autopost_jobs")
    .select("id, attempt_count, locked_at, lock_id, state, next_attempt_at, completed_at, result_status, error_code, error_message")
    .eq("rule_id", ruleId)
    .eq("platform", platform)
    .eq("scheduled_for", scheduledFor)
    .maybeSingle();

  if (error) throw error;
  return data as AutopostJobRow | null;
}

async function createOrFindPendingJob(db: AutopostRunDbClient, args: {
  rule: AutopostRuleForJobs;
  platform: AutopostProofPlatform;
  scheduledFor: string;
  payload: Record<string, unknown>;
}) {
  const { data, error } = await db
    .from("autopost_jobs")
    .insert({
      rule_id: args.rule.id,
      user_id: args.rule.user_id,
      platform: args.platform,
      scheduled_for: args.scheduledFor,
      payload: args.payload,
      state: "QUEUED",
      result_status: "PENDING",
      attempt_count: 0,
      platform_post_id: null,
      error_code: null,
      error_message: null,
      locked_at: null,
      lock_id: null,
      posted_at: null,
      completed_at: null,
      next_attempt_at: null,
    })
    .select("id, attempt_count, locked_at, lock_id, state, next_attempt_at, completed_at, result_status, error_code, error_message")
    .single();

  if (!error && data) {
    const job = data as AutopostJobRow;
    const log = await logJobEvent(db, job.id, "job_created", {
      rule_id: args.rule.id,
      platform: args.platform,
      scheduled_for: args.scheduledFor,
    });
    return { job, created: true, log };
  }

  if (!isDuplicateError(error)) {
    throw error;
  }

  const existingJob = await findExistingJob(db, args.rule.id, args.platform, args.scheduledFor);
  if (!existingJob) throw error;

  const log = await logJobEvent(db, existingJob.id, "job_dedupe_skipped", {
    rule_id: args.rule.id,
    platform: args.platform,
    scheduled_for: args.scheduledFor,
  });

  return { job: existingJob, created: false, log };
}


type DispatchEligibilityReason =
  | "ELIGIBLE"
  | "RETRY_NOT_DUE"
  | "MAX_ATTEMPTS_EXHAUSTED"
  | "TERMINAL_JOB"
  | "CURRENTLY_LOCKED"
  | "LOCK_ELIGIBILITY_CHANGED"
  | "JOB_NOT_FOUND";

function normalizeObservedAttemptCount(value: number | null) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : MAX_X_DISPATCH_ATTEMPTS;
}

function classifyDispatchEligibility(job: AutopostJobRow | null, now: Date): DispatchEligibilityReason {
  if (!job) return "JOB_NOT_FOUND";
  if (job.state !== "QUEUED" || job.completed_at != null) return "TERMINAL_JOB";
  if (job.locked_at != null) {
    const lockedAt = Date.parse(job.locked_at);
    if (!Number.isFinite(lockedAt)) return "CURRENTLY_LOCKED";
    if (lockedAt >= now.getTime() - LOCK_TTL_MS) return "CURRENTLY_LOCKED";
  }
  const attemptCount = normalizeObservedAttemptCount(job.attempt_count);
  if (attemptCount >= MAX_X_DISPATCH_ATTEMPTS) return "MAX_ATTEMPTS_EXHAUSTED";
  if (job.next_attempt_at != null) {
    const nextAttemptAt = Date.parse(job.next_attempt_at);
    if (!Number.isFinite(nextAttemptAt)) return "RETRY_NOT_DUE";
    if (nextAttemptAt > now.getTime()) return "RETRY_NOT_DUE";
  }
  return "ELIGIBLE";
}

async function readJobById(db: AutopostRunDbClient, jobId: string) {
  const { data, error } = await db.from("autopost_jobs").select("id, attempt_count, locked_at, lock_id, state, next_attempt_at, completed_at, result_status, error_code, error_message").eq("id", jobId).maybeSingle();
  if (error) throw error;
  return data as AutopostJobRow | null;
}

async function lockJobIfAvailable(db: AutopostRunDbClient, job: AutopostJobRow, now: Date, countAttempt: boolean) {
  const precheck = classifyDispatchEligibility(job, now);
  if (precheck !== "ELIGIBLE") {
    const log = await logJobEvent(db, job.id, precheck === "RETRY_NOT_DUE" ? "job_retry_not_due" : precheck === "TERMINAL_JOB" ? "job_terminal_skipped" : "job_lock_skipped", {
      reason: precheck,
      attempt_count: normalizeObservedAttemptCount(job.attempt_count),
      max_attempts: MAX_X_DISPATCH_ATTEMPTS,
      next_attempt_at: job.next_attempt_at,
      runner_now: now.toISOString(),
    }, "WARN");
    return { locked: false, job, log, reason: precheck };
  }

  const observedAttemptCount = normalizeObservedAttemptCount(job.attempt_count);
  if (observedAttemptCount >= MAX_X_DISPATCH_ATTEMPTS) {
    const log = await logJobEvent(db, job.id, "job_lock_skipped", { reason: "MAX_ATTEMPTS_EXHAUSTED" }, "WARN");
    return { locked: false, job, log, reason: "MAX_ATTEMPTS_EXHAUSTED" as const };
  }

  const expiredBefore = new Date(now.getTime() - LOCK_TTL_MS).toISOString();
  const capturedNowIso = now.toISOString();
  const lockId = crypto.randomUUID();
  const nextAttemptCount = countAttempt ? observedAttemptCount + 1 : observedAttemptCount;

  const { data, error } = await db
    .from("autopost_jobs")
    .update({
      state: "QUEUED",
      locked_at: capturedNowIso,
      lock_id: lockId,
      attempt_count: nextAttemptCount,
    })
    .eq("id", job.id)
    .eq("state", "QUEUED")
    .is("completed_at", null)
    .eq("attempt_count", observedAttemptCount)
    .or([
      `and(next_attempt_at.is.null,locked_at.is.null)`,
      `and(next_attempt_at.is.null,locked_at.lt.${expiredBefore})`,
      `and(next_attempt_at.lte.${capturedNowIso},locked_at.is.null)`,
      `and(next_attempt_at.lte.${capturedNowIso},locked_at.lt.${expiredBefore})`,
    ].join(","))
    .select("id, attempt_count, locked_at, lock_id, state, next_attempt_at, completed_at, result_status, error_code, error_message")
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const durableJob = await readJobById(db, job.id);
    const durableReason = classifyDispatchEligibility(durableJob, now);
    const reason = durableReason === "ELIGIBLE" ? "LOCK_ELIGIBILITY_CHANGED" : durableReason;
    const log = await logJobEvent(db, job.id, reason === "RETRY_NOT_DUE" ? "job_retry_not_due" : reason === "TERMINAL_JOB" ? "job_terminal_skipped" : "job_lock_skipped", { reason }, "WARN");
    return { locked: false, job: durableJob ?? job, log, reason };
  }

  const lockedJob = data as AutopostJobRow;
  const log = await logJobEvent(db, lockedJob.id, "job_locked", {
    lock_id: lockId,
    dispatches_attempted: countAttempt ? 1 : 0,
    posts_attempted: countAttempt ? 1 : 0,
    lock_mode: countAttempt ? "dispatch_gate" : "foundation_no_dispatch",
    attempt_count: lockedJob.attempt_count,
  });

  return { locked: true, job: lockedJob, log, reason: "ELIGIBLE" as const };
}

/* ──────────────────────────────────────────────
   Executor
────────────────────────────────────────────── */
export async function executeAutopost(req: Request, deps: ExecuteAutopostDeps = {}) {
  const db = deps.supabaseAdmin ?? supabaseAdmin;
  const env = deps.env ?? process.env;
  // Default no-dependency dispatch still resolves to postXTextOnlyAutopost(...).
  const postX = deps.postXTextOnlyAutopost ?? postXTextOnlyAutopost;
  const auth = assertCronAuth(req, deps.cronSecret);
  if (!auth.ok) return json(401, auth);

  const capturedNow = new Date((deps.now ?? (() => new Date()))().getTime());
  const now = Number.isFinite(capturedNow.getTime()) ? capturedNow : new Date();
  const dispatchEnabled = isDispatchGateEnabled(req, env);
  const fanvueDryRunConfirmation = getFanvueDryRunConfirmation(req);
  const schedulablePlatforms: AutopostProofPlatform[] = dispatchEnabled ? ["x"] : getFoundationSchedulablePlatforms(req);
  const claimJobs = shouldClaimJobs(req) || dispatchEnabled;

  const { data: rules, error } = await db
    .from("autopost_rules")
    .select(
      "id,user_id,approval_state,enabled,selected_platforms,next_run_at,timezone,start_date,end_date,posts_per_day,time_slots,paused_at,revoked_at,content_payload"
    )
    .eq("approval_state", "APPROVED")
    .eq("enabled", true)
    .is("paused_at", null)
    .is("revoked_at", null)
    .not("next_run_at", "is", null)
    .lte("next_run_at", now.toISOString());

  if (error) throw error;

  const summary: RunSummary = {
    mode: "job_foundation_no_dispatch",
    scanned: rules?.length ?? 0,
    eligible_rules: 0,
    jobs_created: 0,
    jobs_existing: 0,
    jobs_found: 0,
    jobs_locked: 0,
    job_lock_skipped: 0,
    skipped: 0,
    dispatches_attempted: 0,
    posts_attempted: 0,
    results_posted: 0,
    results_failed: 0,
    result_persistence_failures: 0,
    job_log_persistence_failures: 0,
    results_not_configured: 0,
    results_unsupported: 0,
    schedule_advancements: 0,
    schedule_advancement_skipped: 0,
    fanvue_dry_runs: 0,
    fanvue_dry_run_blocked: 0,
    retry_not_due: 0,
    retry_exhausted: 0,
    terminal_jobs_skipped: 0,
    currently_locked: 0,
    lock_eligibility_changed: 0,
    lock_mode: dispatchEnabled ? "dispatch_gate" : "foundation_no_dispatch",
  };
  const typedRules = (rules ?? []) as AutopostRuleForJobs[];
  const fanvueDryRunResults = runFanvueRouteDryRunVerification({
    rules: typedRules,
    now,
    env,
    request_confirmation: fanvueDryRunConfirmation,
    summary,
  });

  for (const rule of typedRules) {
    const eligibility = evaluateRunRuleEligibility(rule, now, schedulablePlatforms);
    if (!eligibility.eligible) {
      summary.skipped++;
      continue;
    }

    summary.eligible_rules++;

    for (const platform of eligibility.platforms) {
      if (platform !== "x" || !rule.next_run_at) {
        summary.skipped++;
        continue;
      }

      const content = validateXRunContentPayload(rule.content_payload);
      if (!content.valid) {
        summary.skipped++;
        continue;
      }

      const payload = buildXAutopostJobPayload({
        rule_id: rule.id,
        user_id: rule.user_id,
        scheduled_for: rule.next_run_at,
        text: content.text,
        metadata: content.metadata,
      });

      const { job, created, log: createLog } = await createOrFindPendingJob(db, {
        rule,
        platform,
        scheduledFor: rule.next_run_at,
        payload,
      });

      if (created) summary.jobs_created++;
      else summary.jobs_existing++;
      if (!createLog.ok) summary.job_log_persistence_failures++;
      summary.jobs_found++;

      if (claimJobs) {
        const lockResult = await lockJobIfAvailable(db, job, now, dispatchEnabled);
        if (!lockResult.log.ok) summary.job_log_persistence_failures++;
        if (lockResult.locked) {
          summary.jobs_locked++;

          if (dispatchEnabled) {
            summary.dispatches_attempted++;
            summary.posts_attempted++;

            const adapterResult = await postX({
              run_mode: "autopost",
              user_id: rule.user_id,
              rule_id: rule.id,
              job_id: lockResult.job.id,
              payload: { text: content.text },
            });

            const persisted = await persistAutopostJobResult(db, {
              job_id: lockResult.job.id,
              adapter_result: adapterResult,
              now,
              attempt_count: lockResult.job.attempt_count ?? null,
              max_attempts: MAX_X_DISPATCH_ATTEMPTS,
            });

            if (persisted.ok === false || persisted.job_result_persisted === false) {
              summary.result_persistence_failures++;
              summary.results_failed++;
              summary.schedule_advancement_skipped++;
              const skippedLog = await logJobEvent(db, lockResult.job.id, "schedule_advancement_skipped", {
                reason: "JOB_RESULT_PERSIST_FAILED",
                rule_id: rule.id,
                platform: "x",
                scheduled_for: rule.next_run_at,
              }, "WARN");
              if (!skippedLog.ok) summary.job_log_persistence_failures++;
              continue;
            }

            if (
              persisted.audit_log_persisted === false &&
              persisted.audit_log_error_code === "JOB_LOG_PERSIST_FAILED"
            ) {
              summary.job_log_persistence_failures++;
            }

            if (
              persisted.persisted_status === "POSTED" &&
              persisted.posted === true &&
              typeof persisted.platform_post_id === "string" &&
              persisted.platform_post_id.trim() !== ""
            ) {
              summary.results_posted++;

              const advancement = await advanceScheduleAfterPostedProof(db, {
                rule,
                jobId: lockResult.job.id,
                scheduledFor: rule.next_run_at,
                now,
              });

              if (!advancement.log.ok) summary.job_log_persistence_failures++;
              if (advancement.advanced) summary.schedule_advancements++;
              else summary.schedule_advancement_skipped++;
            } else if (persisted.persisted_status === "POSTED") {
              summary.results_failed++;
              summary.schedule_advancement_skipped++;
              const skippedLog = await logJobEvent(db, lockResult.job.id, "schedule_advancement_skipped", {
                reason: "POSTED_RESULT_MISSING_DURABLE_PLATFORM_POST_ID",
                rule_id: rule.id,
                platform: "x",
                scheduled_for: rule.next_run_at,
              }, "WARN");
              if (!skippedLog.ok) summary.job_log_persistence_failures++;
            } else if (persisted.persisted_status === "NOT_CONFIGURED") {
              summary.results_not_configured++;
              summary.schedule_advancement_skipped++;
            } else if (persisted.persisted_status === "UNSUPPORTED") {
              summary.results_unsupported++;
              summary.schedule_advancement_skipped++;
            } else {
              summary.results_failed++;
              summary.schedule_advancement_skipped++;
            }
          }
        } else {
          if (lockResult.reason === "MAX_ATTEMPTS_EXHAUSTED") {
            const exhausted = await persistAutopostRetryExhaustion(db, {
              job_id: lockResult.job.id,
              now,
              attempt_count: normalizeObservedAttemptCount(lockResult.job.attempt_count),
              max_attempts: MAX_X_DISPATCH_ATTEMPTS,
              error_code: lockResult.job.error_code,
              error_message: lockResult.job.error_message,
            });
            if (exhausted.ok && exhausted.job_result_persisted) {
              summary.retry_exhausted++;
              summary.results_failed++;
            } else {
              summary.result_persistence_failures++;
            }
            if (!exhausted.audit_log_persisted && exhausted.audit_log_error_code === "JOB_LOG_PERSIST_FAILED") summary.job_log_persistence_failures++;
            summary.schedule_advancement_skipped++;
          } else {
            summary.job_lock_skipped++;
            if (lockResult.reason === "RETRY_NOT_DUE") summary.retry_not_due++;
            else if (lockResult.reason === "TERMINAL_JOB") summary.terminal_jobs_skipped++;
            else if (lockResult.reason === "CURRENTLY_LOCKED") summary.currently_locked++;
            else summary.lock_eligibility_changed++;
          }
        }
      }
    }
  }

  return json(200, {
    ok: true,
    mode: "job_foundation_no_dispatch",
    message: dispatchEnabled
      ? "Internal X dispatch gate executed for locked jobs. Schedule advancement runs only after persisted POSTED proof."
      : "Autopost run is limited to job creation/locking foundation. No dispatch or posting was attempted.",
    dispatch_enabled: dispatchEnabled,
    schedule_advancement_enabled: dispatchEnabled,
    schedulable_platforms: schedulablePlatforms,
    claim_jobs: claimJobs,
    fanvue_dry_run_confirmed: isFanvueRouteDryRunConfirmed(fanvueDryRunConfirmation),
    summary,
    fanvue_dry_run_results: fanvueDryRunResults,
  });
}

/* ──────────────────────────────────────────────
   Routes
────────────────────────────────────────────── */
export async function GET(req: Request) {
  return executeAutopost(req);
}

export async function POST(req: Request) {
  return executeAutopost(req);
}
