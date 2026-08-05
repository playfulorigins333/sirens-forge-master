export const PAYMENT_V2_LIFECYCLE_PHASES = ["PFC-07E-A2", "PFC-07E-A3", "PFC-07E-B"] as const;
export type PaymentV2LifecyclePhase = typeof PAYMENT_V2_LIFECYCLE_PHASES[number];
export type PaymentV2RecognizedLifecycleType =
  | "refund.created"
  | "refund.updated"
  | "refund.failed"
  | "customer.subscription.updated"
  | "customer.subscription.deleted"
  | "invoice.payment_failed"
  | "invoice.paid"
  | "charge.dispute.created"
  | "charge.dispute.closed";

export type PaymentV2LifecycleClassification = {
  eventType: PaymentV2RecognizedLifecycleType;
  lifecyclePhase: PaymentV2LifecyclePhase;
  providerObjectType: "refund" | "subscription" | "invoice" | "dispute";
};

const lifecycleEvents: Record<PaymentV2RecognizedLifecycleType, Omit<PaymentV2LifecycleClassification, "eventType">> = {
  "refund.created": { lifecyclePhase: "PFC-07E-A2", providerObjectType: "refund" },
  "refund.updated": { lifecyclePhase: "PFC-07E-A2", providerObjectType: "refund" },
  "refund.failed": { lifecyclePhase: "PFC-07E-A2", providerObjectType: "refund" },
  "customer.subscription.updated": { lifecyclePhase: "PFC-07E-A3", providerObjectType: "subscription" },
  "customer.subscription.deleted": { lifecyclePhase: "PFC-07E-A3", providerObjectType: "subscription" },
  "invoice.payment_failed": { lifecyclePhase: "PFC-07E-A3", providerObjectType: "invoice" },
  "invoice.paid": { lifecyclePhase: "PFC-07E-A3", providerObjectType: "invoice" },
  "charge.dispute.created": { lifecyclePhase: "PFC-07E-B", providerObjectType: "dispute" },
  "charge.dispute.closed": { lifecyclePhase: "PFC-07E-B", providerObjectType: "dispute" },
};

export function classifyPaymentV2LifecycleEvent(type: string): PaymentV2LifecycleClassification | null {
  if (!Object.prototype.hasOwnProperty.call(lifecycleEvents, type)) return null;
  const mapped = lifecycleEvents[type as PaymentV2RecognizedLifecycleType];
  return { eventType: type as PaymentV2RecognizedLifecycleType, ...mapped };
}

export function isPaymentV2LifecyclePhase(value: string): value is PaymentV2LifecyclePhase {
  return (PAYMENT_V2_LIFECYCLE_PHASES as readonly string[]).includes(value);
}
