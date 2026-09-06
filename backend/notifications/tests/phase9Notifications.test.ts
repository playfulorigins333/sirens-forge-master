import test from "node:test"
import assert from "node:assert/strict"
import { notificationsEnabled, runNotifications } from "../../../lib/notifications/service"
import { buildNotification } from "../../../lib/notifications/templates"
import { classifyResendError, createResendTransport } from "../../../lib/notifications/resend"
import { notificationKinds } from "../../../lib/notifications/types"

test("delivery is exact-default-off and missing transport config fails closed", () => {
  assert.equal(notificationsEnabled({} as NodeJS.ProcessEnv), false)
  assert.equal(notificationsEnabled({ PHASE9_NOTIFICATIONS_ENABLED: "TRUE" } as NodeJS.ProcessEnv), false)
  assert.equal(notificationsEnabled({ PHASE9_NOTIFICATIONS_ENABLED: "true" } as NodeJS.ProcessEnv), true)
  assert.throws(() => createResendTransport({} as NodeJS.ProcessEnv), /NOTIFICATION_TRANSPORT_NOT_CONFIGURED/)
})

test("all twelve templates use canonical .vip fallback and allow the canonical env override", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL
  delete process.env.NEXT_PUBLIC_SITE_URL
  for (const kind of notificationKinds) {
    const mail = buildNotification(kind, context)
    assert.match(mail.html, /https:\/\/www\.sirensforge\.vip/)
    assert.doesNotMatch(mail.html, /sirensforge\.com/)
    assert.match(mail.text, /transactional account notice/)
  }
  process.env.NEXT_PUBLIC_SITE_URL = "https://preview.sirensforge.vip/"
  assert.match(buildNotification("export_ready", context).html, /https:\/\/preview\.sirensforge\.vip\/account\/data-rights/)
  if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = previous
})

test("Resend error classification follows actual SDK statusCode and name fields", () => {
  for (const statusCode of [408, 425, 429, 500, 503]) assert.equal(classifyResendError({ name: "application_error", statusCode } as any), "retry")
  for (const name of ["rate_limit_exceeded", "application_error", "internal_server_error", "concurrent_idempotent_requests"]) assert.equal(classifyResendError({ name, statusCode: null } as any), "retry")
  for (const name of ["validation_error", "invalid_from_address", "invalid_parameter", "invalid_api_key"]) assert.equal(classifyResendError({ name, statusCode: 400 } as any), "permanent")
})

test("Resend transport returns retry, permanent, uncertain, and delivered without a real request", async () => {
  const env = { RESEND_API_KEY: "test", PHASE9_NOTIFICATION_FROM_EMAIL: "test@example.invalid" } as NodeJS.ProcessEnv
  const mail = { subject: "s", text: "t", html: "<p>t</p>" }
  const result = async (value: unknown) => createResendTransport(env, { emails: { send: async () => value } } as any).send({ to: "creator@example.invalid", mail, idempotencyKey: "phase9/test" })
  assert.equal((await result({ data: null, error: { name: "rate_limit_exceeded", message: "secret", statusCode: 429 } })).kind, "retry")
  assert.equal((await result({ data: null, error: { name: "validation_error", message: "secret", statusCode: 422 } })).kind, "permanent")
  assert.equal((await result({ data: { id: "provider-id" }, error: null })).kind, "delivered")
  const uncertain = createResendTransport(env, { emails: { send: async () => { throw new Error("network") } } } as any)
  assert.equal((await uncertain.send({ to: "creator@example.invalid", mail, idempotencyKey: "phase9/test" })).kind, "uncertain")
})

const context = { expiresAt: "2026-10-01T00:00:00Z", recoveryDeadline: "2026-11-01T00:00:00Z", completedAt: "2026-09-01T00:00:00Z", paidAccessEndsAt: "2026-09-01T00:00:00Z", retentionUntil: "2026-11-01T00:00:00Z", retentionStartedAt: "2026-09-01T00:00:00Z" }
const row = (id = "n1", user = "u1") => ({ id, source_type: "creator_data_export", source_id: `s-${id}`, notification_kind: "export_ready" as const, auth_user_id: user, due_at: "2026-09-01", attempts: 1, context })
function db(rows: any[], lookup: (id: string) => Promise<any> = async id => ({ data: { user: { id, email: `${id}@example.test` } }, error: null })) {
  const calls: any[] = []
  return { calls, auth: { admin: { getUserById: lookup } }, rpc: async (name: string, args: any) => { calls.push([name, args]); if (name === "materialize_phase9_notifications") return { data: 1, error: null }; if (name === "claim_phase9_notifications") return { data: rows, error: null }; return { data: true, error: null } } }
}

test("delivery uses authoritative recipient, stable idempotency, and sanitized evidence/logging", async () => {
  const database = db([row()]); let sent: any, logged: any
  const result = await runNotifications({ db: database as any, transport: { send: async input => (sent = input, { kind: "delivered", providerMessageId: "provider-secret-id" }) }, log: event => logged = event })
  assert.equal(sent.to, "u1@example.test"); assert.equal(sent.idempotencyKey, "phase9/n1")
  assert.deepEqual(result, { materialized: 1, claimed: 1, delivered: 1, retried: 0, suppressed: 0, uncertain: 0 })
  assert.equal(JSON.stringify(logged).includes("example.test"), false)
  const final = database.calls.findLast(call => call[0] === "finalize_phase9_notification")[1]
  assert.equal(final.p_outcome, "delivered"); assert.match(final.p_provider_message_id_hash, /^[a-f0-9]{64}$/); assert.equal(JSON.stringify(final).includes("provider-secret-id"), false)
})

test("transient Auth failure retries and does not abandon the rest of a claimed batch", async () => {
  const database = db([row("n1", "u1"), row("n2", "u2")], async id => id === "u1" ? { data: { user: null }, error: { message: "transient secret" } } : { data: { user: { id, email: `${id}@example.test` } }, error: null })
  const sent: string[] = []
  const result = await runNotifications({ db: database as any, transport: { send: async input => { sent.push(input.idempotencyKey); return { kind: "delivered", providerMessageId: input.idempotencyKey } } } })
  assert.deepEqual(sent, ["phase9/n2"]); assert.equal(result.retried, 1); assert.equal(result.delivered, 1)
  assert.deepEqual(database.calls.filter(call => call[0] === "finalize_phase9_notification").map(call => call[1].p_outcome), ["retry", "delivered"])
})

test("authoritative missing, invalid, permanent, and uncertain results finalize distinctly", async () => {
  const cases: Array<[any, any, string, string | null]> = [
    [async () => ({ data: { user: null }, error: null }), { send: async () => { throw new Error("must not send") } }, "suppressed", "recipient_missing"],
    [async () => ({ data: { user: { id: "u1", email: "invalid" } }, error: null }), { send: async () => { throw new Error("must not send") } }, "suppressed", "recipient_invalid"],
    [undefined, { send: async () => ({ kind: "permanent", code: "SAFE" }) }, "suppressed", "provider_permanent"],
    [undefined, { send: async () => ({ kind: "uncertain", code: "SAFE" }) }, "failed_uncertain", "provider_outcome_uncertain"]
  ]
  for (const [lookup, transport, outcome, reason] of cases) {
    const database = db([row()], lookup)
    await runNotifications({ db: database as any, transport })
    const final = database.calls.findLast(call => call[0] === "finalize_phase9_notification")[1]
    assert.equal(final.p_outcome, outcome); assert.equal(final.p_reason, reason)
  }
})
