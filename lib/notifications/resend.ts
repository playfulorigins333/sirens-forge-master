import "server-only"
import { Resend, type ErrorResponse } from "resend"
import type { NotificationTransport } from "./types"

type ResendClient = Pick<Resend, "emails">
const transientNames = new Set(["rate_limit_exceeded", "application_error", "internal_server_error", "concurrent_idempotent_requests"])

export function classifyResendError(error: Pick<ErrorResponse, "name" | "statusCode">): "retry" | "permanent" {
  const status = error.statusCode
  if (status === 408 || status === 425 || status === 429 || (status !== null && status >= 500)) return "retry"
  if (status !== null && status >= 400 && status < 500) return "permanent"
  return transientNames.has(error.name) ? "retry" : "permanent"
}

export function createResendTransport(env: NodeJS.ProcessEnv = process.env, client?: ResendClient): NotificationTransport {
  const key = env.RESEND_API_KEY, from = env.PHASE9_NOTIFICATION_FROM_EMAIL
  if (!key || !from) throw new Error("NOTIFICATION_TRANSPORT_NOT_CONFIGURED")
  const resend = client ?? new Resend(key)
  return { async send({ to, mail, idempotencyKey }) {
    try {
      const result = await resend.emails.send({ from, to, subject: mail.subject, text: mail.text, html: mail.html }, { idempotencyKey })
      if (result.error) return { kind: classifyResendError(result.error), code: classifyResendError(result.error) === "retry" ? "PROVIDER_RETRYABLE" : "PROVIDER_PERMANENT" }
      if (!result.data?.id) return { kind: "uncertain", code: "PROVIDER_OUTCOME_UNCERTAIN" }
      return { kind: "delivered", providerMessageId: result.data.id }
    } catch {
      return { kind: "uncertain", code: "PROVIDER_OUTCOME_UNCERTAIN" }
    }
  } }
}
