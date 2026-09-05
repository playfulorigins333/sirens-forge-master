import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path: string) => readFileSync(path, "utf8")
const deletion = read("supabase/migrations/20260905045000_phase7_closeout_account_deletion_billing_guard.sql")
const publishing = read("supabase/migrations/20260905045100_phase7_closeout_publishing_execution_guard.sql")

test("voluntary deletion cannot use delinquency to bypass recurring cancellation", () => {
  assert.match(deletion, /stripe_subscription_id is not null/)
  assert.match(deletion, /'active','trialing','past_due','unpaid'/)
  assert.match(deletion, /cancel_at_period_end,false/)
  assert.match(deletion, /ACCOUNT_DELETION_BILLING_ACTIVE/)
  assert.match(deletion, /before insert on public\.account_deletion_requests/)
})

test("background provider dispatch rechecks Phase 7 lifecycle state", () => {
  assert.match(publishing, /phase7_creator_lifecycle_execution_allowed/)
  assert.match(publishing, /account_lifecycle_state/)
  assert.match(publishing, /subscription_payment_delinquencies/)
  assert.match(publishing, /first_miss_frozen/)
  assert.match(publishing, /retention_countdown/)
  assert.match(publishing, /v_tier_name = 'og_throne' and v_stripe_subscription_id is null/)
  assert.match(publishing, /v_current_period_end <= now\(\)/)
  assert.match(publishing, /autopost_begin_x_dispatch/)
  assert.match(publishing, /creator_publishing_claim_scheduled_fanvue_jobs/)
  assert.match(publishing, /creator_publishing_mark_fanvue_create_dispatched/)
  assert.match(publishing, /and public\.phase7_creator_lifecycle_execution_allowed\(j\.creator_id\)/)
})

test("closeout publishing gates remain service/internal only", () => {
  assert.match(publishing, /revoke all on function public\.phase7_creator_lifecycle_execution_allowed\(uuid\) from public, anon, authenticated/)
  assert.match(publishing, /revoke all on function public\.autopost_begin_x_dispatch\(uuid,uuid,text\) from public,anon,authenticated/)
  assert.match(publishing, /grant execute on function public\.autopost_begin_x_dispatch\(uuid,uuid,text\) to service_role/)
  assert.match(publishing, /revoke all on function public\.creator_publishing_claim_scheduled_fanvue_jobs\(integer,integer\) from public,anon,authenticated/)
  assert.match(publishing, /revoke all on function public\.creator_publishing_mark_fanvue_create_dispatched\(uuid,uuid\) from public,anon,authenticated/)
})

test("legacy Autopost creator mutations use the canonical active-subscription gate", () => {
  for (const path of [
    "app/api/autopost/rules/route.ts",
    "app/api/autopost/rules/[rule_id]/approve/route.ts",
    "app/api/autopost/rules/[rule_id]/resume/route.ts",
    "app/api/autopost/connect/x/start/route.ts",
  ]) {
    assert.match(read(path), /ensureActiveSubscription/)
  }

  const start = read("app/api/autopost/connect/x/start/route.ts")
  assert.match(start, /requireFreshTotpResponse/)
  assert.match(start, /const mfa = await requireFreshTotpResponse\(\)[\s\S]*ensureActiveSubscription\(\)/)
  assert.match(start, /entitlement\.user\?\.id !== mfa\.userId/)

  const callback = read("app/api/autopost/connect/x/callback/route.ts")
  assert.match(callback, /statePayload\.flow === "reauthorize"[\s\S]*completeXReauthorization/)
  assert.match(callback, /ensureActiveSubscription\(\)[\s\S]*completeInitialXOAuthConnection/)
})

test("Fanvue claim-to-create lifecycle race remains retryable without provider create", () => {
  const worker = read("lib/creator-publishing-queue/fanvue/workerCore.ts")
  assert.match(worker, /retryablePreCreateCodes[\s\S]*FANVUE_EXECUTION_CREATE_DISPATCH_MARKER_FAILED/)
})

test("closeout does not pull Phase 8 purge or Phase 9 delivery into Phase 7", () => {
  const sql = `${deletion}\n${publishing}`.toLowerCase()
  assert.doesNotMatch(sql, /delete\s+from/)
  assert.doesNotMatch(sql, /auth\.users\s+.*delete/)
  assert.doesNotMatch(sql, /send[_ ]?(email|notification)|deliver[_ ]?notification/)
})
