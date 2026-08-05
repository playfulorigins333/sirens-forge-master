import { createHash } from "node:crypto";
import { classifyPaymentV2LifecycleEvent, type PaymentV2LifecycleClassification } from "./eventClassification";

export type InboxStatus = "RECEIVED" | "PENDING_PHASE" | "PENDING_PURCHASE" | "PENDING_RETRY" | "PROCESSED" | "IGNORED_NON_V2" | "FAILED_TERMINAL";
export type InboxReceiveArgs = {
  p_provider_event_id: string;
  p_provider_event_type: string;
  p_provider_object_id: string;
  p_provider_object_type: string;
  p_provider_created_at: string;
  p_raw_payload_sha256: string;
  p_lifecycle_phase: string;
  p_lifecycle_version: number;
};
export interface PaymentV2InboxDatabase {
  receiveEvent(args: InboxReceiveArgs): Promise<InboxStatus>;
  transitionStatus(args: { p_provider_event_id: string; p_expected_status: InboxStatus; p_new_status: InboxStatus; p_error_code: string | null; p_count_attempt: boolean }): Promise<InboxStatus>;
}
export type MinimalStripeEvent = { id: string; type: string; created: number; data: { object?: { id?: string } | null } };

const providerId = /^[A-Za-z0-9_:\-\.]+$/;
const sha = /^[0-9a-f]{64}$/;

export function rawPayloadSha256(rawBody: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(rawBody)).digest("hex");
}

export function lifecycleEventEnvelope(event: MinimalStripeEvent, rawBody: Uint8Array): { classification: PaymentV2LifecycleClassification; args: InboxReceiveArgs } | null {
  const classification = classifyPaymentV2LifecycleEvent(event.type);
  if (!classification) return null;
  const objectId = event.data?.object?.id;
  if (!validProviderIdentifier(event.id) || !validProviderIdentifier(event.type) || !validProviderIdentifier(objectId) || !Number.isInteger(event.created) || event.created < 0) return null;
  const digest = rawPayloadSha256(rawBody);
  if (!sha.test(digest)) return null;
  return { classification, args: { p_provider_event_id: event.id.trim(), p_provider_event_type: event.type.trim(), p_provider_object_id: objectId!.trim(), p_provider_object_type: classification.providerObjectType, p_provider_created_at: new Date(event.created * 1000).toISOString(), p_raw_payload_sha256: digest, p_lifecycle_phase: classification.lifecyclePhase, p_lifecycle_version: 1 } };
}

export function responseForInboxStatus(status: InboxStatus, replay = false) {
  if (replay) return { status: 200, body: { status: "received", code: "PAYMENT_V2_EVENT_REPLAYED" } };
  if (status === "PENDING_PHASE") return { status: 200, body: { status: "pending", code: "PAYMENT_V2_EVENT_PENDING_PHASE" } };
  if (status === "PENDING_PURCHASE") return { status: 200, body: { status: "pending", code: "PAYMENT_V2_EVENT_PENDING_PURCHASE" } };
  if (status === "PENDING_RETRY") return { status: 200, body: { status: "pending", code: "PAYMENT_V2_EVENT_PENDING_RETRY" } };
  if (status === "PROCESSED") return { status: 200, body: { status: "received", code: "PAYMENT_V2_EVENT_PROCESSED" } };
  if (status === "IGNORED_NON_V2") return { status: 200, body: { status: "ignored", code: "NON_PAYMENT_V2_EVENT_IGNORED" } };
  if (status === "FAILED_TERMINAL") return { status: 200, body: { status: "failed", code: "PAYMENT_V2_EVENT_FAILED_TERMINAL" } };
  return { status: 503, body: { error: "Payment V2 event inbox is unavailable", code: "PAYMENT_V2_EVENT_INBOX_UNAVAILABLE" } };
}

function validProviderIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 255 && providerId.test(value);
}
