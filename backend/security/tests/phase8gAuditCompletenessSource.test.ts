import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync("supabase/migrations/20260905120000_phase8g_deletion_billing_export_audit.sql", "utf8")
const dataRights = readFileSync("lib/account-data-rights.ts", "utf8")
const deletionRoute = readFileSync("app/api/account/deletion/request/route.ts", "utf8")
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

const triggerFunctions = [
  "phase8g_audit_creator_data_export",
  "phase8g_audit_account_deletion",
  "phase8g_audit_payment_v2_hold",
  "phase8g_audit_payment_v2_purchase",
  "phase8g_audit_user_subscription",
  "phase8g_audit_payment_provider_event",
]

test("Phase 8G is forward-only audit/receipt coverage and keeps Production separately gated", () => {
  assert.match(migration, /Phase 8G: deletion, billing, and export audit completeness/)
  assert.match(migration, /forward-looking audit\/receipt coverage; it does not invent historical actions/)
  assert.match(migration, /Production application requires separate explicit authorization/)
  assert.match(migration, /phase8g\.audit_boundary_established/)
  assert.match(migration, /no historical actions inferred/)
})

test("deletion request atomically records receipts bound to the actual confirmation and export choices", () => {
  assert.match(dataRights, /ACCOUNT_DELETION_CONFIRMATION_VERSION = "delete-my-account-v1"/)
  assert.match(dataRights, /ACCOUNT_DELETION_CONFIRMATION_PHRASE = "DELETE MY ACCOUNT"/)
  assert.match(dataRights, /input\.confirmationPhrase !== ACCOUNT_DELETION_CONFIRMATION_PHRASE/)
  assert.match(deletionRoute, /confirmation_phrase/)
  assert.match(deletionRoute, /requestVoluntaryAccountDeletion/)

  const deletionHash = sha256("DELETE MY ACCOUNT")
  const exportHash = sha256("export_before_deletion")
  const skipHash = sha256("skip_export")
  assert.equal(deletionHash, "6837962104899009382198c0c17b490e4eaeedb5cf5b85a1a778d27aecc41aa7")
  assert.equal(exportHash, "9cbf4c6c11a096ec02d0f9b287e483b2b6e1c09b1eda6846ea05775fb8d0a2b4")
  assert.equal(skipHash, "d16a228c076e477ec7263977f0b22bcf897db8e9b0524e56aafeb39a19802af4")
  for (const hash of [deletionHash, exportHash, skipHash]) assert.match(migration, new RegExp(hash))

  assert.match(migration, /'account\.deletion_requested'/)
  assert.match(migration, /'account_deletion'[\s\S]*'request_deletion'[\s\S]*'confirmed'/)
  assert.match(migration, /'creator_export_choice'/)
  assert.match(migration, /account\.deletion_reactivated/)
  assert.match(migration, /account\.deletion_purge_claimed/)
  assert.match(migration, /account\.deletion_completed/)
})

test("export lifecycle includes request, processing, completion, failure, download, expiry and retry evidence", () => {
  for (const action of [
    "export.requested",
    "export.processing_started",
    "export.completed",
    "export.failed",
    "export.downloaded",
    "export.expired",
    "export.processing_reclaimed",
  ]) assert.match(migration, new RegExp(action.replaceAll(".", "\\.")))
  assert.match(migration, /'export_sha256',new\.sha256/)
})

test("billing audit is attached to durable hold, purchase, subscription and provider-event tables", () => {
  for (const table of ["payment_v2_holds", "payment_v2_purchases", "user_subscriptions", "payment_v2_provider_event_inbox"]) {
    assert.match(migration, new RegExp(`after insert or update on public\\.${table}`))
  }
  for (const action of [
    "billing.checkout_hold_created",
    "billing.purchase_recorded",
    "billing.purchase_claimed",
    "billing.subscription_recorded",
    "billing.subscription_cancellation_scheduled",
    "billing.subscription_cancellation_reversed",
    "billing.subscription_status_changed",
    "billing.provider_event_received",
    "billing.provider_event_status_changed",
  ]) assert.match(migration, new RegExp(action.replaceAll(".", "\\.")))
})

test("provider and storage identifiers are represented by hashes, not governance plaintext", () => {
  assert.match(migration, /raw_payload_sha256/)
  assert.match(migration, /provider_event_sha256/)
  assert.match(migration, /provider_object_sha256/)
  assert.match(migration, /checkout_session_sha256/)
  assert.match(migration, /subscription_sha256/)
  assert.match(migration, /customer_sha256/)
  assert.doesNotMatch(migration, /jsonb_build_object\([^;]*'storage_object_key'/s)
  assert.doesNotMatch(migration, /jsonb_build_object\([^;]*'purchaser_credential_hash'/s)
})

test("Phase 8G trigger helpers are SECURITY DEFINER but are not directly callable", () => {
  for (const fn of triggerFunctions) {
    assert.match(migration, new RegExp(`create or replace function public\\.${fn}\\(\\)[\\s\\S]*?security definer`, "i"))
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}\\(\\) from public,anon,authenticated,service_role`, "i"))
  }
})

test("Phase 8G does not replace billing/data-rights state machines or deliver Phase 9 notifications", () => {
  assert.doesNotMatch(migration, /create or replace function public\.payment_v2_(?:record_paid|apply_early_bird_subscription_lifecycle|record_subscription_payment_failure|recover_subscription_payment_delinquency)/i)
  assert.doesNotMatch(migration, /create or replace function public\.(?:request_creator_data_export|request_voluntary_account_deletion|reactivate_voluntary_account_deletion)/i)
  assert.doesNotMatch(migration, /\b(?:send_email|send_notification|deliver_notification)\s*\(/i)
  assert.doesNotMatch(migration, /cron\.schedule|pg_cron/i)
})

test("Phase 8G adds no browser-callable governance surface", () => {
  assert.doesNotMatch(migration, /grant execute on function public\.[^;]+ to (?:anon|authenticated)/i)
  assert.doesNotMatch(migration, /grant (?:select|insert|update|delete|all)[^;]+ to (?:anon|authenticated)/i)
})