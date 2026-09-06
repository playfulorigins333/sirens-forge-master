import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { buildNotification } from "./templates"
import type { ClaimedNotification, NotificationTransport } from "./types"

type DbResult = { data: unknown; error: { message: string } | null }
type Db = { rpc(name: string, args: Record<string, unknown>): Promise<DbResult>; auth: { admin: { getUserById(id: string): Promise<{ data: { user: { id: string; email?: string } | null }; error: unknown }> } } }
export type NotificationRun = { materialized: number; claimed: number; delivered: number; retried: number; suppressed: number; uncertain: number }
const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
export const notificationsEnabled = (env: NodeJS.ProcessEnv = process.env) => env.PHASE9_NOTIFICATIONS_ENABLED === "true"

export async function runNotifications(input: { db: Db; transport: NotificationTransport; limit?: number; log?: (event: Record<string, unknown>) => void }): Promise<NotificationRun> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50)
  const out = { materialized: 0, claimed: 0, delivered: 0, retried: 0, suppressed: 0, uncertain: 0 }
  const materialized = await input.db.rpc("materialize_phase9_notifications", { p_limit: limit * 4 })
  if (materialized.error) throw new Error("NOTIFICATION_MATERIALIZE_FAILED")
  out.materialized = Number(materialized.data ?? 0)
  const leaseToken = randomUUID()
  const claim = await input.db.rpc("claim_phase9_notifications", { p_lease_token: leaseToken, p_limit: limit })
  if (claim.error) throw new Error("NOTIFICATION_CLAIM_FAILED")
  const rows = (claim.data ?? []) as ClaimedNotification[]
  out.claimed = rows.length

  for (const row of rows) {
    let outcome: "delivered" | "retry" | "suppressed" | "failed_uncertain" = "retry"
    let reason: string | null = null
    let providerHash: string | null = null
    let attemptStarted = false
    let finalizedByPreparation = false
    try {
      const identity = await input.db.auth.admin.getUserById(row.auth_user_id)
      if (identity.error) {
        outcome = "retry"
      } else if (!identity.data.user) {
        outcome = "suppressed"; reason = "recipient_missing"
      } else if (identity.data.user.id !== row.auth_user_id) {
        outcome = "suppressed"; reason = "ownership_mismatch"
      } else if (!identity.data.user.email || !validEmail(identity.data.user.email)) {
        outcome = "suppressed"; reason = identity.data.user.email ? "recipient_invalid" : "recipient_missing"
      } else {
        const mail = buildNotification(row.notification_kind, row.context)
        const prepared = await input.db.rpc("prepare_phase9_notification_attempt", { p_id: row.id, p_lease_token: leaseToken })
        if (prepared.error || prepared.data === "unavailable") {
          outcome = "retry"
        } else if (prepared.data === "suppressed") {
          outcome = "suppressed"; reason = "source_stale"; finalizedByPreparation = true
        } else {
          attemptStarted = true
          const result = await input.transport.send({ to: identity.data.user.email, mail, idempotencyKey: `phase9/${row.id}` })
          if (result.kind === "delivered") {
            outcome = "delivered"; providerHash = createHash("sha256").update(result.providerMessageId).digest("hex")
          } else if (result.kind === "permanent") {
            outcome = "suppressed"; reason = "provider_permanent"
          } else if (result.kind === "uncertain") {
            outcome = "failed_uncertain"; reason = "provider_outcome_uncertain"
          }
        }
      }
    } catch {
      // The durable timestamp resolves whether a thrown operation occurred before
      // or after provider delivery could have begun.
      outcome = attemptStarted ? "failed_uncertain" : "retry"
      reason = outcome === "failed_uncertain" ? "provider_outcome_uncertain" : null
    }
    if (outcome === "delivered") out.delivered++
    else if (outcome === "retry") out.retried++
    else if (outcome === "failed_uncertain") out.uncertain++
    else out.suppressed++
    if (finalizedByPreparation) input.log?.({ event: "phase9_notification_finalized", kind: row.notification_kind, outcome, attempt: row.attempts })
    else {
      const finalized = await input.db.rpc("finalize_phase9_notification", { p_id: row.id, p_lease_token: leaseToken, p_outcome: outcome, p_reason: reason, p_provider_message_id_hash: providerHash })
      if (finalized.error || finalized.data !== true) input.log?.({ event: "phase9_notification_finalize_failed", kind: row.notification_kind, outcome, attempt: row.attempts })
      else input.log?.({ event: "phase9_notification_finalized", kind: row.notification_kind, outcome, attempt: row.attempts })
    }
  }
  return out
}
