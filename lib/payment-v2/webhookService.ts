import { classifyPaymentV2LifecycleEvent } from "./eventClassification";
import { lifecycleEventEnvelope, responseForInboxStatus, type InboxStatus, type PaymentV2InboxDatabase } from "./eventInboxService";

export const PAYMENT_V2_WEBHOOK_CONTRACT = "pfc-03-v2";

export type PaymentV2Tier = "og_throne" | "early_bird";
export type WebhookEventType =
  | "checkout.session.completed"
  | "checkout.session.async_payment_succeeded"
  | "checkout.session.expired"
  | "checkout.session.async_payment_failed";

export type StripeEvent = { id: string; type: string; created: number; data: { object: { id?: string; metadata?: Record<string, string> | null } } };
export type StripeSession = {
  id: string; mode: string | null; status: string | null; payment_status: string | null;
  customer: unknown; payment_intent: unknown; subscription: unknown; amount_total?: number | null; currency?: string | null;
  metadata?: Record<string, string> | null;
  line_items?: { data: Array<{ quantity?: number | null; amount_total?: number | null; price?: { id?: string; unit_amount?: number | null; currency?: string | null } | null }> };
};
export type StripePaymentIntent = { id: string; status: string; customer: unknown; amount: number; currency: string; latest_charge?: unknown };
export type StripeSubscription = { id: string; customer: unknown; status: string; current_period_start?: number; current_period_end?: number; cancel_at_period_end?: boolean; canceled_at?: number | null; trial_start?: number | null; trial_end?: number | null; metadata?: Record<string,string> | null; items?: { data: Array<{ quantity?: number | null; current_period_start?: number; current_period_end?: number; price?: { id?: string } | null }> }; latest_invoice?: unknown };
export type StripeInvoicePayment={id:string;invoice:unknown;status:string;amount_paid:number|null;currency:string;payment:{type:string;payment_intent?:unknown}};
export type StripeInvoice = { id?: string; customer?: unknown; status?: string | null; amount_due?: number; amount_paid?: number; currency?: string | null; parent?:{type:string;subscription_details?:{subscription:unknown;metadata?:Record<string,string>|null}|null}|null;payments?:unknown };
export type StripeRecurringInvoice = StripeInvoice & { id: string; customer?: unknown; billing_reason?: string | null; lines?: { data: Array<{ amount?: number; quantity?: number | null; pricing?:{type:string;price_details?:{price:unknown}|null}|null; period?: { start?: number; end?: number } }> }; status_transitions?: { paid_at?: number | null } | null };

export type HoldRow = { id: string; state: string; tier: string; expires_at: string; stripe_checkout_session_id: string | null; purchaser_credential_hash: string | Uint8Array };
export type TierRow = { name: string; is_active: boolean; stripe_price_id: string | null };
export type PurchaseRow = { hold_id: string; tier: string; stripe_checkout_session_id: string; stripe_customer_id: string; stripe_price_id: string; stripe_payment_intent_id: string | null; stripe_subscription_id: string | null };

export interface PaymentV2Provider {
  constructEvent(rawBody: Uint8Array, signature: string, secret: string): StripeEvent;
  retrieveSession(id: string): Promise<StripeSession>;
  retrievePaymentIntent(id: string): Promise<StripePaymentIntent>;
  retrieveSubscription(id: string): Promise<StripeSubscription>;
  retrieveInvoice?(id:string):Promise<StripeRecurringInvoice>;
  listInvoicePayments?(invoiceId:string):Promise<StripeInvoicePayment[]>;
  listPaidInvoices?(subscriptionId: string): Promise<StripeRecurringInvoice[]>;
}
export interface PaymentV2Database {
  loadHold(id: string): Promise<HoldRow[]>;
  loadTier(name: PaymentV2Tier): Promise<TierRow[]>;
  loadPurchase(holdId: string): Promise<PurchaseRow[]>;
  recordPaid(args: Record<string, unknown>): Promise<string>;
  recordTerminal(args: Record<string, unknown>): Promise<string>;
  reconcilePaidInvoices?(args: Record<string, unknown>): Promise<string>;
  applyEarlyBirdLifecycle?(args: Record<string, unknown>): Promise<string>;
}
export type WebhookResponse = { status: number; body: Record<string, string> };
export interface WebhookInput {
  enabled?: string; inboxEnabled?: string; apiKey?: string; webhookSecret?: string; signature: string | null;
  readRawBody(): Promise<Uint8Array>;
  createProvider(apiKey: string): PaymentV2Provider;
  createDatabase(): PaymentV2Database;
  createInboxDatabase?(): PaymentV2InboxDatabase;
}

const response = (status: number, body: Record<string, string>): WebhookResponse => ({ status, body });
const disabled = () => response(503, { error: "Payment-first webhook is not active", code: "PAYMENT_FIRST_WEBHOOK_V2_DISABLED" });
const badSignature = () => response(400, { error: "Invalid webhook signature", code: "INVALID_WEBHOOK_SIGNATURE" });
const failed = () => response(500, { error: "Unable to process payment event", code: "PAYMENT_FIRST_WEBHOOK_V2_ERROR" });
const ignored = () => response(200, { status: "ignored", code: "NON_PAYMENT_V2_EVENT_IGNORED" });
const inboxNotReady = () => response(503, { error: "Payment V2 event inbox is not ready", code: "PAYMENT_V2_EVENT_INBOX_NOT_READY" });
const inboxUnavailable = () => response(503, { error: "Payment V2 event inbox is unavailable", code: "PAYMENT_V2_EVENT_INBOX_UNAVAILABLE" });
const inboxConflict = () => response(503, { error: "Payment V2 event inbox conflict", code: "PAYMENT_V2_EVENT_INBOX_CONFLICT" });
const invalidLifecycleEnvelope = () => response(503, { error: "Invalid Payment V2 lifecycle event envelope", code: "PAYMENT_V2_EVENT_ENVELOPE_INVALID" });
const pending = () => response(200, { status: "pending" });
const received = () => response(200, { status: "received" });
const supported = new Set<string>(["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired", "checkout.session.async_payment_failed"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string" ? (value as { id: string }).id : null;
const timestamp = (created: number) => Number.isInteger(created) && created >= 0 ? new Date(created * 1000).toISOString() : null;
const nullableTimestamp = (created: number | null | undefined) => created == null ? null : timestamp(created);
const subscriptionStatuses = new Set(["active", "trialing", "past_due", "canceled", "unpaid", "paused", "incomplete", "incomplete_expired"]);

async function processA3(event: StripeEvent, provider: PaymentV2Provider, db: PaymentV2Database): Promise<{ status: InboxStatus; error: string | null }> {
  let subscriptionId: string | null = null;
  let customerId: string | null = null;
  let invoiceMetadata: ReturnType<typeof metadata> | null = null;
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    subscriptionId = id(event.data.object.id);
  } else if (event.type === "invoice.payment_failed") {
    if (!provider.retrieveInvoice) return { status: "PENDING_RETRY", error: "PROVIDER_UNAVAILABLE" };
    const invoiceId = id(event.data.object.id);
    if (!invoiceId) return { status: "FAILED_TERMINAL", error: "MALFORMED_PROVIDER_IDENTITY" };
    const invoice = await provider.retrieveInvoice(invoiceId);
    if (invoice.id !== invoiceId) return { status: "FAILED_TERMINAL", error: "INVOICE_IDENTITY_MISMATCH" };
    subscriptionId = invoice.parent?.type === "subscription_details" ? id(invoice.parent.subscription_details?.subscription) : null;
    customerId = id(invoice.customer);
    if (invoice.parent?.subscription_details?.metadata) invoiceMetadata = metadata({ metadata: invoice.parent.subscription_details.metadata });
  } else return { status: "PENDING_PHASE", error: null };
  if (!subscriptionId) return { status: "FAILED_TERMINAL", error: "MALFORMED_PROVIDER_IDENTITY" };
  const subscription = await provider.retrieveSubscription(subscriptionId);
  const authoritativeCustomer = id(subscription.customer);
  if (subscription.id !== subscriptionId || !authoritativeCustomer || (customerId && customerId !== authoritativeCustomer)) {
    return { status: "FAILED_TERMINAL", error: "SUBSCRIPTION_IDENTITY_MISMATCH" };
  }
  const discriminator = metadata(subscription);
  if (discriminator.kind === "legacy") return { status: "IGNORED_NON_V2", error: null };
  if (discriminator.kind !== "v2" || discriminator.tier !== "early_bird") return { status: "FAILED_TERMINAL", error: "INVALID_V2_METADATA" };
  if (invoiceMetadata?.kind === "v2" && (invoiceMetadata.tier !== discriminator.tier || invoiceMetadata.holdId !== discriminator.holdId)) {
    return { status: "FAILED_TERMINAL", error: "INVOICE_METADATA_MISMATCH" };
  }
  if (!subscriptionStatuses.has(subscription.status) || typeof subscription.cancel_at_period_end !== "boolean") {
    return { status: "FAILED_TERMINAL", error: "UNSUPPORTED_SUBSCRIPTION_STATUS" };
  }
  const subscriptionItem = subscription.items?.data.length === 1 ? subscription.items.data[0] : null;
  const currentPeriodStart = subscription.current_period_start ?? subscriptionItem?.current_period_start;
  const currentPeriodEnd = subscription.current_period_end ?? subscriptionItem?.current_period_end;
  const periodStart = nullableTimestamp(currentPeriodStart), periodEnd = nullableTimestamp(currentPeriodEnd);
  const canceledAt = nullableTimestamp(subscription.canceled_at), trialStart = nullableTimestamp(subscription.trial_start), trialEnd = nullableTimestamp(subscription.trial_end);
  if ((currentPeriodStart != null && !periodStart) || (currentPeriodEnd != null && !periodEnd) ||
      (subscription.canceled_at != null && !canceledAt) || (subscription.trial_start != null && !trialStart) || (subscription.trial_end != null && !trialEnd) || !db.applyEarlyBirdLifecycle) {
    return { status: "FAILED_TERMINAL", error: "INVALID_SUBSCRIPTION_SNAPSHOT" };
  }
  const result = await db.applyEarlyBirdLifecycle({ p_subscription_id: subscriptionId, p_customer_id: authoritativeCustomer, p_status: subscription.status,
    p_current_period_start: periodStart, p_current_period_end: periodEnd, p_cancel_at_period_end: subscription.cancel_at_period_end,
    p_canceled_at: canceledAt, p_trial_start: trialStart, p_trial_end: trialEnd });
  if (result === "purchase_pending") return { status: "PENDING_PURCHASE", error: "PURCHASE_PENDING" };
  if (["applied", "unclaimed", "terminal_noop"].includes(result)) return { status: "PROCESSED", error: null };
  return { status: "FAILED_TERMINAL", error: "LIFECYCLE_RESULT_INVALID" };
}

export async function recurringInvoice(event: StripeEvent, provider: PaymentV2Provider, db: PaymentV2Database): Promise<WebhookResponse> {
  const invoice = event.data.object as StripeRecurringInvoice;
  const subscriptionId = invoice.parent?.type==="subscription_details"?id(invoice.parent.subscription_details?.subscription):null; const customerId = id(invoice.customer);
  const paidAt = timestamp(invoice.status_transitions?.paid_at ?? event.created);
  if (!invoice.id || invoice.status !== "paid" || !subscriptionId || !customerId || !paidAt ||
      !Number.isInteger(invoice.amount_paid) || invoice.amount_paid! < 0 || invoice.amount_due !== invoice.amount_paid ||
      typeof invoice.currency !== "string" || !/^[a-z]{3}$/.test(invoice.currency.toLowerCase())) return failed();
  const subscription = await provider.retrieveSubscription(subscriptionId);
  const snapshot=invoice.parent?.subscription_details?.metadata;
  const md = snapshot ? metadata({metadata:snapshot}) : metadata(subscription);
  if (md.kind === "legacy") return ignored();
  if(md.kind==="v2"&&!['subscription_create','subscription_cycle'].includes(invoice.billing_reason||""))return ignored();
  const currentMd=metadata(subscription);
  if (subscription.id !== subscriptionId || id(subscription.customer) !== customerId ||
      md.kind !== "v2" || md.tier !== "early_bird" || !db.reconcilePaidInvoices || !provider.listPaidInvoices||!provider.listInvoicePayments) return failed();
  if(currentMd.kind==="v2"&&(currentMd.holdId!==md.holdId||currentMd.tier!==md.tier))return failed();
  const items=subscription.items?.data; if(items?.length!==1||items[0].quantity!==1||!items[0].price?.id) return failed();
  const history=await provider.listPaidInvoices(subscriptionId); const normalized=[] as Record<string,unknown>[];
  for(const inv of history){ const line=inv.lines?.data?.[0], price=line?.pricing?.type==="price_details"?id(line.pricing.price_details?.price):null;
    if(!["subscription_create","subscription_cycle"].includes(inv.billing_reason||"")||price!==items[0].price.id) continue;
    const payments=await provider.listInvoicePayments(inv.id);if(payments.length!==1||payments[0].status!=="paid"||payments[0].payment.type!=="payment_intent"||id(payments[0].invoice)!==inv.id)return failed();const piId=id(payments[0].payment.payment_intent);if(!piId)return failed();const pi=await provider.retrievePaymentIntent(piId);
    if(inv.status!=="paid"||inv.lines?.data.length!==1||line?.quantity!==1||!Number.isInteger(line.period?.start)||!Number.isInteger(line.period?.end)||pi.status!=="succeeded"||id(pi.customer)!==customerId||pi.amount!==payments[0].amount_paid||payments[0].amount_paid!==inv.amount_paid||pi.currency?.toLowerCase()!==inv.currency?.toLowerCase()||!id(pi.latest_charge)||!Number.isInteger(inv.amount_paid)||inv.amount_paid!==inv.amount_due||typeof inv.currency!=="string") return failed();
    normalized.push({invoiceId:inv.id,providerEventId:inv.id===invoice.id?event.id:null,paymentIntentId:pi.id,sourceChargeId:id(pi.latest_charge),subscriptionId,customerId,priceId:items[0].price.id,billingReason:inv.billing_reason,periodStart:timestamp(line.period!.start!),periodEnd:timestamp(line.period!.end!),grossAmountCents:inv.amount_paid,currency:inv.currency.toLowerCase()}); }
  if(!normalized.some(x=>x.invoiceId===invoice.id)) return failed();
  const recorded=await db.reconcilePaidInvoices({p_hold_id:md.holdId,p_subscription_id:subscriptionId,p_customer_id:customerId,p_price_id:items[0].price.id,p_provider_event_id:event.id,p_invoices:normalized});
  if(!["reconciled","no_attribution"].includes(recorded)) return failed();
  return received();
}

function hashBytes(value: HoldRow["purchaser_credential_hash"]): Uint8Array | null {
  if (value instanceof Uint8Array) return value.length === 32 ? value : null;
  if (typeof value !== "string") return null;
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  return /^[0-9a-f]{64}$/i.test(hex) ? Uint8Array.from(Buffer.from(hex, "hex")) : null;
}

function metadata(object: { metadata?: Record<string, string> | null }): { kind: "legacy" } | { kind: "invalid" } | { kind: "v2"; holdId: string; tier: PaymentV2Tier } {
  const md = object.metadata || {};
  if (md.checkout_contract_version !== PAYMENT_V2_WEBHOOK_CONTRACT) return { kind: "legacy" };
  if (!uuid.test(md.payment_v2_hold_id || "") || (md.tier_name !== "og_throne" && md.tier_name !== "early_bird")) return { kind: "invalid" };
  return { kind: "v2", holdId: md.payment_v2_hold_id, tier: md.tier_name };
}

function exactPurchase(row: PurchaseRow, holdId: string, tier: PaymentV2Tier, session: StripeSession, price: string, pi: string | null, sub: string | null) {
  const customer = id(session.customer);
  return Boolean(customer) && row.hold_id === holdId && row.tier === tier && row.stripe_checkout_session_id === session.id && row.stripe_price_id === price &&
    row.stripe_customer_id === customer && row.stripe_payment_intent_id === pi && row.stripe_subscription_id === sub;
}

function commonSession(session: StripeSession, sessionId: string, holdId: string, tier: PaymentV2Tier, price: string) {
  const md = metadata(session);
  const lines = session.line_items?.data;
  const line = lines?.[0];
  return session.id === sessionId && md.kind === "v2" && md.holdId === holdId && md.tier === tier && lines?.length === 1 && line?.quantity === 1 && line.price?.id === price;
}

type PaidEvidence = { customer: string; paymentIntent: string | null; subscription: string | null; sourcePaymentIntent:string; sourceCharge: string; initialInvoice: string|null; grossAmountCents: number; currency: string };

async function verifyPaid(session: StripeSession, tier: PaymentV2Tier, price: string, provider: PaymentV2Provider): Promise<PaidEvidence | null> {
  if (session.status !== "complete") return null;
  const customer = id(session.customer);
  if (!customer || session.payment_status !== "paid") return null;
  let paymentIntent: string | null = null;
  let subscription: string | null = null;
  let sourceCharge: string | null = null; let sourcePaymentIntent:string|null=null; let initialInvoice: string|null=null;
  const line = session.line_items!.data[0];
  const grossAmountCents = line.amount_total ?? (typeof line.price?.unit_amount === "number" ? line.price.unit_amount : null);
  const currency = (line.price?.currency || session.currency || "").toLowerCase();
  if (!Number.isInteger(grossAmountCents) || grossAmountCents! < 0 || !/^[a-z]{3}$/.test(currency) || session.amount_total !== grossAmountCents) return null;
  if (tier === "og_throne") {
    paymentIntent = id(session.payment_intent);
    if (session.mode !== "payment" || !paymentIntent || id(session.subscription)) return null;
    const pi = await provider.retrievePaymentIntent(paymentIntent);
    sourcePaymentIntent=pi.id;
    sourceCharge=id(pi.latest_charge);
    const amount = line.amount_total ?? (typeof line.price?.unit_amount === "number" ? line.price.unit_amount : null);
    const currency = line.price?.currency?.toLowerCase();
    if (pi.id !== paymentIntent || !sourceCharge || pi.status !== "succeeded" || id(pi.customer) !== customer || amount === null || pi.amount !== amount ||
        !currency || pi.currency.toLowerCase() !== currency || session.amount_total !== amount || session.currency?.toLowerCase() !== currency) return null;
  } else {
    subscription = id(session.subscription);
    if (session.mode !== "subscription" || !subscription || id(session.payment_intent)) return null;
    const sub = await provider.retrieveSubscription(subscription);
    const items = sub.items?.data;
    if (sub.id !== subscription || id(sub.customer) !== customer || !["active", "trialing"].includes(sub.status) ||
        items?.length !== 1 || items[0].quantity !== 1 || items[0].price?.id !== price) return null;
    if (!sub.latest_invoice || typeof sub.latest_invoice !== "object" || Array.isArray(sub.latest_invoice)) return null;
    const invoice = sub.latest_invoice as StripeInvoice;
    initialInvoice=invoice.id||null;if(!initialInvoice||!provider.listInvoicePayments)return null;const payments=await provider.listInvoicePayments(initialInvoice);if(payments.length!==1||payments[0].status!=="paid"||payments[0].payment.type!=="payment_intent"||id(payments[0].invoice)!==initialInvoice)return null;sourcePaymentIntent=id(payments[0].payment.payment_intent);if(!sourcePaymentIntent)return null;const pi=await provider.retrievePaymentIntent(sourcePaymentIntent);sourceCharge=id(pi.latest_charge);
    if (invoice.status !== "paid" || !sourceCharge || pi.status!=="succeeded" || id(pi.customer)!==customer || pi.amount!==grossAmountCents || payments[0].amount_paid!==grossAmountCents || pi.currency?.toLowerCase()!==currency) return null;
    if (typeof invoice.currency === "string" && invoice.currency.toLowerCase() !== currency) return null;
    if (typeof invoice.amount_paid === "number" && invoice.amount_paid !== grossAmountCents) return null;
    if (typeof invoice.amount_due === "number" && typeof invoice.amount_paid === "number" && invoice.amount_paid < invoice.amount_due) return null;
  }
  return { customer, paymentIntent, subscription, sourcePaymentIntent:sourcePaymentIntent!, sourceCharge:sourceCharge!, initialInvoice, grossAmountCents: grossAmountCents!, currency };
}

async function recordPaid(event: StripeEvent, session: StripeSession, hold: HoldRow, tier: PaymentV2Tier, price: string, hash: Uint8Array, provider: PaymentV2Provider, db: PaymentV2Database): Promise<WebhookResponse> {
  if (session.status !== "complete") return failed();
  if (session.payment_status !== "paid") {
    const coherent = id(session.customer) && (tier === "og_throne"
      ? session.mode === "payment" && Boolean(id(session.payment_intent)) && !id(session.subscription)
      : session.mode === "subscription" && Boolean(id(session.subscription)) && !id(session.payment_intent));
    return event.type === "checkout.session.completed" && coherent ? pending() : failed();
  }
  const evidence = await verifyPaid(session, tier, price, provider);
  if (!evidence) return failed();
  const purchases = await db.loadPurchase(hold.id);
  if (purchases.length > 1) return failed();
  if (purchases.length === 1) return exactPurchase(purchases[0], hold.id, tier, session, price, evidence.paymentIntent, evidence.subscription) ? received() : failed();
  if (hold.state !== "SESSION_ASSOCIATED") return failed();
  const confirmed = timestamp(event.created); if (!confirmed) return failed();
  try {
    const result = await db.recordPaid({ p_hold_id: hold.id, p_purchaser_hash: hash, p_session_id: session.id, p_customer_id: evidence.customer,
      p_price_id: price, p_payment_intent_id: evidence.paymentIntent, p_subscription_id: evidence.subscription, p_provider_event_id: event.id, p_provider_confirmed_at: confirmed,
      p_gross_amount_cents: evidence.grossAmountCents, p_currency: evidence.currency, p_source_payment_intent_id:evidence.sourcePaymentIntent,p_source_charge_id:evidence.sourceCharge,p_initial_invoice_id:evidence.initialInvoice });
    return result === "recorded" || result === "already_recorded" ? received() : failed();
  } catch (cause) {
    if (!(cause instanceof Error) || cause.message !== "paid_purchase_conflict") throw cause;
    const raced = await db.loadPurchase(hold.id);
    return raced.length === 1 && exactPurchase(raced[0], hold.id, tier, session, price, evidence.paymentIntent, evidence.subscription) ? received() : failed();
  }
}

export async function paymentFirstWebhook(input: WebhookInput): Promise<WebhookResponse> {
  if (input.enabled !== "true") return disabled();
  if (!input.apiKey || !input.webhookSecret || !input.signature) return input.signature ? failed() : badSignature();
  let provider: PaymentV2Provider; let event: StripeEvent; let raw: Uint8Array;
  try {
    provider = input.createProvider(input.apiKey);
    raw = await input.readRawBody();
    event = provider.constructEvent(raw, input.signature, input.webhookSecret);
  } catch { return badSignature(); }
  if (event.type === "invoice.paid") {
    const invoiceId=id(event.data.object.id);
    if(!invoiceId||!provider.retrieveInvoice)return failed();
    try {
      const invoice=await provider.retrieveInvoice(invoiceId);
      if(invoice.id!==invoiceId)return failed();
      if(invoice.parent?.type!=="subscription_details"||!id(invoice.parent.subscription_details?.subscription))return ignored();
      return await recurringInvoice({...event,data:{object:invoice}}, provider, input.createDatabase());
    } catch { return failed(); }
  }
  if (!supported.has(event.type)) {
    const classification = classifyPaymentV2LifecycleEvent(event.type);
    if (!classification) return ignored();
    if (input.inboxEnabled !== "true" || !input.createInboxDatabase) return inboxNotReady();
    const envelope = lifecycleEventEnvelope(event as any, raw);
    if (!envelope) return invalidLifecycleEnvelope();
    try {
      const inbox = input.createInboxDatabase();
      const received = await inbox.receiveEvent(envelope.args);
      let current = received as InboxStatus;
      if (current === "RECEIVED") current = await inbox.transitionStatus({ p_provider_event_id: envelope.args.p_provider_event_id, p_expected_status: "RECEIVED", p_new_status: "PENDING_PHASE", p_error_code: null, p_count_attempt: false });
      if (["PROCESSED", "IGNORED_NON_V2", "FAILED_TERMINAL"].includes(current)) return responseForInboxStatus(current, true) as WebhookResponse;
      if (envelope.classification.lifecyclePhase !== "PFC-07E-A3" || event.type === "invoice.paid") return responseForInboxStatus(current) as WebhookResponse;
      try {
        const outcome = await processA3(event, provider, input.createDatabase());
        const transitioned = await inbox.transitionStatus({ p_provider_event_id: envelope.args.p_provider_event_id, p_expected_status: current, p_new_status: outcome.status, p_error_code: outcome.error, p_count_attempt: true });
        return responseForInboxStatus(transitioned) as WebhookResponse;
      } catch (cause) {
        const terminal = cause instanceof Error && /^(subscription_customer_mismatch|purchase_ambiguous|unclaimed_relationship_mismatch|claimed_relationship_mismatch|allocation_identity_mismatch|entitlement_cardinality_mismatch|entitlement_identity_mismatch|invalid_subscription_snapshot)$/.test(cause.message);
        const transitioned = await inbox.transitionStatus({ p_provider_event_id: envelope.args.p_provider_event_id, p_expected_status: current, p_new_status: terminal ? "FAILED_TERMINAL" : "PENDING_RETRY", p_error_code: terminal ? "DATABASE_IDENTITY_MISMATCH" : "TRANSIENT_PROCESSING_FAILURE", p_count_attempt: true });
        return responseForInboxStatus(transitioned) as WebhookResponse;
      }
      return inboxUnavailable();
    } catch (cause) {
      return cause instanceof Error && cause.message === "inbox_event_conflict" ? inboxConflict() : inboxUnavailable();
    }
  }
  const embedded = event.data?.object;
  if (!embedded?.id) return failed();
  const discriminator = metadata(embedded);
  if (discriminator.kind === "legacy") return ignored();
  if (discriminator.kind === "invalid") return failed();
  try {
    const db = input.createDatabase();
    const holds = await db.loadHold(discriminator.holdId);
    if (holds.length !== 1) return failed();
    const hold = holds[0]; const hash = hashBytes(hold.purchaser_credential_hash);
    if (hold.id !== discriminator.holdId || hold.tier !== discriminator.tier || hold.stripe_checkout_session_id !== embedded.id || !hash) return failed();
    const tiers = await db.loadTier(discriminator.tier);
    if (tiers.length !== 1 || tiers[0].name !== discriminator.tier || tiers[0].is_active !== true || !tiers[0].stripe_price_id?.trim()) return failed();
    const price = tiers[0].stripe_price_id.trim();
    const session = await provider.retrieveSession(embedded.id);
    if (!commonSession(session, embedded.id, hold.id, discriminator.tier, price)) return failed();
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      if (!["SESSION_ASSOCIATED", "PAID_UNCLAIMED", "CLAIMED", "REFUNDED", "REVOKED"].includes(hold.state)) return failed();
      return recordPaid(event, session, hold, discriminator.tier, price, hash, provider, db);
    }

    const terminalState = event.type === "checkout.session.expired" ? "EXPIRED_UNPAID" : "CANCELED_UNPAID";
    if (hold.state !== "SESSION_ASSOCIATED" && hold.state !== terminalState && !["PAID_UNCLAIMED", "CLAIMED", "REFUNDED", "REVOKED"].includes(hold.state)) return failed();
    const purchases = await db.loadPurchase(hold.id);
    if (purchases.length > 1) return failed();
    if (session.payment_status === "paid") {
      const evidence = await verifyPaid(session, discriminator.tier, price, provider);
      return evidence && purchases.length === 1 && exactPurchase(purchases[0], hold.id, discriminator.tier, session, price, evidence.paymentIntent, evidence.subscription) ? received() : failed();
    }
    if (purchases.length !== 0 || hold.state === "PAID_UNCLAIMED" || hold.state === "CLAIMED" || hold.state === "REFUNDED" || hold.state === "REVOKED") return failed();
    if (event.type === "checkout.session.expired" && session.status !== "expired") return failed();
    const occurred = timestamp(event.created); if (!occurred) return failed();
    const kind = event.type === "checkout.session.expired" ? "SESSION_EXPIRED_UNPAID" : "PAYMENT_CANCELED_UNPAID";
    let terminal: string;
    try { terminal = await db.recordTerminal({ p_hold_id: hold.id, p_session_id: session.id, p_event_kind: kind, p_provider_event_id: event.id, p_provider_occurred_at: occurred }); }
    catch (cause) {
      if (!(cause instanceof Error) || cause.message !== "paid_purchase_exists") throw cause;
      const raced = await db.loadPurchase(hold.id);
      const current = await provider.retrieveSession(session.id);
      if (!commonSession(current, session.id, hold.id, discriminator.tier, price)) return failed();
      const evidence = await verifyPaid(current, discriminator.tier, price, provider);
      return evidence && raced.length === 1 && exactPurchase(raced[0], hold.id, discriminator.tier, current, price, evidence.paymentIntent, evidence.subscription) ? received() : failed();
    }
    return ["expired", "canceled", "already_recorded"].includes(terminal) ? received() : failed();
  } catch { return failed(); }
}
