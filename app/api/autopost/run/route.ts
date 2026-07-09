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
import { persistAutopostJobResult } from "@/lib/autopost/jobResults";
import { calculateNextRunAtAfterPostedProof } from "@/lib/autopost/scheduleAdvance";
import { postXTextOnlyAutopost } from "@/lib/autopost/xAdapter";
import { runFanvueDryRunBranch } from "@/lib/autopost/fanvueRunDryRunBranch";

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

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
  results_not_configured: number;
  results_unsupported: number;
  schedule_advancements: number;
  schedule_advancement_skipped: number;
  fanvue_dry_runs: number;
  fanvue_dry_run_blocked: number;
  lock_mode: "foundation_no_dispatch" | "dispatch_gate";
};

/* ──────────────────────────────────────────────
   Helpers
────────────────────────────────────────────── */
function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function nowISO() {
  return new Date().toISOString();
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

function isDispatchGateEnabled(req: Request) {
  const url = new URL(req.url);
  const requested = url.searchParams.get("dispatch") === "1" || url.searchParams.get("execute") === "1";
  return requested && process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED === "true";
}

/* ──────────────────────────────────────────────
   Cron Auth
────────────────────────────────────────────── */
function assertCronAuth(req: Request) {
  if (!CRON_SECRET) {
    return { ok: false as const, error: "CRON_SECRET_NOT_CONFIGURED" };
  }

  const auth = req.headers.get("authorization") || "";
  const xCron = req.headers.get("x-vercel-cron-secret") || "";

  if (auth === `Bearer ${CRON_SECRET}`) return { ok: true as const };
  if (xCron === CRON_SECRET) return { ok: true as const };

  return { ok: false as const, error: "UNAUTHORIZED" };
}

/* ──────────────────────────────────────────────
   DB Helpers
────────────────────────────────────────────── */
async function logJobEvent(jobId: string, message: string, meta: Record<string, unknown> = {}) {
  await supabaseAdmin.from("autopost_job_logs").insert({
    job_id: jobId,
    level: "info",
    message,
    meta,
  });
}

async function advanceScheduleAfterPostedProof(args: {
  rule: AutopostRuleForJobs;
  jobId: string;
  scheduledFor: string;
  now: Date;
}) {
  const { data: persistedJob, error } = await supabaseAdmin
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
    await logJobEvent(args.jobId, "schedule_advancement_skipped", {
      reason: "POSTED_PROOF_NOT_PERSISTED_FOR_SLOT",
      rule_id: args.rule.id,
      platform: "x",
      scheduled_for: args.scheduledFor,
    });
    return { advanced: false, skipped: true, reason: "POSTED_PROOF_NOT_PERSISTED_FOR_SLOT" };
  }

  const nextRun = calculateNextRunAtAfterPostedProof({
    rule: args.rule,
    scheduled_for: args.scheduledFor,
    now: args.now,
  });

  if (nextRun.ok === false) {
    await logJobEvent(args.jobId, "schedule_advancement_skipped", {
      reason: nextRun.error_code,
      rule_id: args.rule.id,
      platform: "x",
      scheduled_for: args.scheduledFor,
    });
    return { advanced: false, skipped: true, reason: nextRun.error_code };
  }

  const { data: updatedRule, error: updateError } = await supabaseAdmin
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
    await logJobEvent(args.jobId, "schedule_advancement_skipped", {
      reason: "RULE_NOT_ADVANCEABLE",
      rule_id: args.rule.id,
      platform: "x",
      scheduled_for: args.scheduledFor,
    });
    return { advanced: false, skipped: true, reason: "RULE_NOT_ADVANCEABLE" };
  }

  await logJobEvent(args.jobId, "schedule_advanced", {
    rule_id: args.rule.id,
    platform: "x",
    scheduled_for: args.scheduledFor,
    next_run_at: nextRun.next_run_at,
    reason: nextRun.reason,
  });

  return { advanced: true, skipped: false, next_run_at: nextRun.next_run_at };
}

async function findExistingJob(ruleId: string, platform: AutopostProofPlatform, scheduledFor: string) {
  const { data, error } = await supabaseAdmin
    .from("autopost_jobs")
    .select("id, attempt_count, locked_at, lock_id, state")
    .eq("rule_id", ruleId)
    .eq("platform", platform)
    .eq("scheduled_for", scheduledFor)
    .maybeSingle();

  if (error) throw error;
  return data as AutopostJobRow | null;
}

async function createOrFindPendingJob(args: {
  rule: AutopostRuleForJobs;
  platform: AutopostProofPlatform;
  scheduledFor: string;
  payload: Record<string, unknown>;
}) {
  const { data, error } = await supabaseAdmin
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
    })
    .select("id, attempt_count, locked_at, lock_id, state")
    .single();

  if (!error && data) {
    const job = data as AutopostJobRow;
    await logJobEvent(job.id, "job_created", {
      rule_id: args.rule.id,
      platform: args.platform,
      scheduled_for: args.scheduledFor,
    });
    return { job, created: true };
  }

  if (!isDuplicateError(error)) {
    throw error;
  }

  const existingJob = await findExistingJob(args.rule.id, args.platform, args.scheduledFor);
  if (!existingJob) throw error;

  await logJobEvent(existingJob.id, "job_dedupe_skipped", {
    rule_id: args.rule.id,
    platform: args.platform,
    scheduled_for: args.scheduledFor,
  });

  return { job: existingJob, created: false };
}

async function lockJobIfAvailable(job: AutopostJobRow, now: Date, countAttempt: boolean) {
  const expiredBefore = new Date(now.getTime() - LOCK_TTL_MS).toISOString();
  const lockId = crypto.randomUUID();
  const nextAttemptCount = countAttempt ? (job.attempt_count ?? 0) + 1 : job.attempt_count ?? 0;

  const { data, error } = await supabaseAdmin
    .from("autopost_jobs")
    .update({
      state: "QUEUED",
      locked_at: now.toISOString(),
      lock_id: lockId,
      attempt_count: nextAttemptCount,
    })
    .eq("id", job.id)
    .eq("state", "QUEUED")
    .or(`locked_at.is.null,locked_at.lt.${expiredBefore}`)
    .select("id, attempt_count, locked_at, lock_id, state")
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    await logJobEvent(job.id, "job_lock_skipped", {
      reason: "JOB_ALREADY_LOCKED_OR_NOT_QUEUED",
    });
    return { locked: false, job };
  }

  const lockedJob = data as AutopostJobRow;
  await logJobEvent(lockedJob.id, "job_locked", {
    lock_id: lockId,
    dispatches_attempted: 0,
    posts_attempted: 0,
    lock_mode: "foundation_no_dispatch",
  });

  return { locked: true, job: lockedJob };
}

/* ──────────────────────────────────────────────
   Executor
────────────────────────────────────────────── */
async function executeAutopost(req: Request) {
  const auth = assertCronAuth(req);
  if (!auth.ok) return json(401, auth);

  const now = new Date();
  const dispatchEnabled = isDispatchGateEnabled(req);
  const schedulablePlatforms: AutopostProofPlatform[] = dispatchEnabled ? ["x"] : getFoundationSchedulablePlatforms(req);
  const claimJobs = shouldClaimJobs(req) || dispatchEnabled;

  const { data: rules, error } = await supabaseAdmin
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
    results_not_configured: 0,
    results_unsupported: 0,
    schedule_advancements: 0,
    schedule_advancement_skipped: 0,
    fanvue_dry_runs: 0,
    fanvue_dry_run_blocked: 0,
    lock_mode: dispatchEnabled ? "dispatch_gate" : "foundation_no_dispatch",
  };
  const fanvueDryRunResults: unknown[] = [];

  for (const rule of (rules ?? []) as AutopostRuleForJobs[]) {
    if (Array.isArray(rule.selected_platforms) && rule.selected_platforms.includes("fanvue")) {
      const fanvueDryRun = runFanvueDryRunBranch({ rule, now });
      if (fanvueDryRun.safe_code === "FANVUE_MOCKED_RUNNER_PERSISTENCE_SUCCESS") {
        summary.fanvue_dry_runs++;
      } else {
        summary.fanvue_dry_run_blocked++;
      }
      fanvueDryRunResults.push(fanvueDryRun);
    }

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

      const { job, created } = await createOrFindPendingJob({
        rule,
        platform,
        scheduledFor: rule.next_run_at,
        payload,
      });

      if (created) summary.jobs_created++;
      else summary.jobs_existing++;
      summary.jobs_found++;

      if (claimJobs) {
        const lockResult = await lockJobIfAvailable(job, now, dispatchEnabled);
        if (lockResult.locked) {
          summary.jobs_locked++;

          if (dispatchEnabled) {
            summary.dispatches_attempted++;
            summary.posts_attempted++;

            const adapterResult = await postXTextOnlyAutopost({
              run_mode: "autopost",
              user_id: rule.user_id,
              rule_id: rule.id,
              job_id: lockResult.job.id,
              payload: { text: content.text },
            });

            const persisted = await persistAutopostJobResult(supabaseAdmin, {
              job_id: lockResult.job.id,
              adapter_result: adapterResult,
              now,
            });

            if (persisted.persisted_status === "POSTED") {
              summary.results_posted++;

              const advancement = await advanceScheduleAfterPostedProof({
                rule,
                jobId: lockResult.job.id,
                scheduledFor: rule.next_run_at,
                now: new Date(),
              });

              if (advancement.advanced) summary.schedule_advancements++;
              else summary.schedule_advancement_skipped++;
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
          summary.job_lock_skipped++;
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
