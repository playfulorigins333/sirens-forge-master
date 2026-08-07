import { createHash, randomBytes } from "node:crypto";
import { LOCKED_PAYMENT_V2_PRICES } from "./publicPurchaseReadiness";

export const PAYMENT_V2_COOKIE = "sf_payment_v2_claim";
export const PAYMENT_V2_CONTRACT_VERSION = "pfc-03-v2";
export const PAYMENT_V2_HOLD_MINUTES = 60;
export const PAYMENT_V2_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

export type PaymentTier = "og_throne" | "early_bird";
type Hold = { holdId: string; state: string; expiresAt: string; connectDestination?: string | null; commissionPercent?: number | null };
type TierRow = { name: string; is_active: boolean; stripe_price_id: string | null };
export type Session = {
  id: string; url: string | null; status?: string | null; payment_status?: string | null;
  expires_at?: number | null; metadata?: Record<string, string> | null;
};

export interface CheckoutDependencies {
  now(): Date;
  randomCredential(): Buffer;
  loadTier(name: PaymentTier): Promise<TierRow[]>;
  acquireHold(hash: Uint8Array, tier: PaymentTier, expiresAt: string, referralCode: string | null): Promise<Hold>;
  loadAssociatedSessionId(holdId: string, hash: Uint8Array): Promise<string | null>;
  associateSession(holdId: string, hash: Uint8Array, sessionId: string): Promise<string>;
  createSession(params: Record<string, unknown>, idempotencyKey: string): Promise<Session>;
  retrieveSession(id: string): Promise<Session>;
  loadPriceUnitAmount?(priceId: string): Promise<number | null>;
}

export type CheckoutResult = {
  status: number;
  body: Record<string, string>;
  cookie?: { name: string; value: string; httpOnly: true; sameSite: "lax"; secure: boolean; path: "/"; maxAge: number };
};

const error = (status: number, message: string, code: string): CheckoutResult => ({ status, body: { error: message, code } });
const serverError = () => error(500, "Unable to start Checkout", "PAYMENT_FIRST_CHECKOUT_V2_ERROR");

export type ValidatedCheckoutRequest = { tierName: PaymentTier; referralCode?: string };

export function parseCheckoutBody(body: unknown): ValidatedCheckoutRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (!Object.hasOwn(record, "tierName") || Object.keys(record).some((key) => key !== "tierName" && key !== "referralCode")) return null;
  if (record.tierName !== "og_throne" && record.tierName !== "early_bird") return null;
  if (record.referralCode === undefined) return { tierName: record.tierName };
  if (typeof record.referralCode !== "string") return null;
  const referralCode = record.referralCode.toUpperCase();
  if (!/^[A-Z0-9_-]{4,20}$/.test(referralCode)) return null;
  return { tierName: record.tierName, referralCode };
}

function credential(rawCookie: string | undefined, deps: CheckoutDependencies) {
  let raw: Buffer | undefined;
  if (rawCookie && /^[A-Za-z0-9_-]{43}$/.test(rawCookie)) {
    const decoded = Buffer.from(rawCookie, "base64url");
    if (decoded.length === 32) raw = decoded;
  }
  raw ??= deps.randomCredential();
  if (raw.length !== 32) throw new Error("credential generation failed");
  return { encoded: raw.toString("base64url"), hash: createHash("sha256").update(raw).digest() };
}

function safeSession(session: Session, holdId: string, tier: PaymentTier, now: Date) {
  return Boolean(session.url && session.status === "open" && session.payment_status === "unpaid" &&
    typeof session.expires_at === "number" && session.expires_at > Math.floor(now.getTime() / 1000) &&
    session.metadata?.payment_v2_hold_id === holdId && session.metadata?.tier_name === tier &&
    session.metadata?.checkout_contract_version === PAYMENT_V2_CONTRACT_VERSION);
}

function trustedOrigin(configured: string | undefined, production: boolean): string | null {
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    if ((production && parsed.protocol !== "https:") || (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
        parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname.replace(/\/+$/, "")) return null;
    return parsed.origin;
  } catch { return null; }
}

export function defaultCheckoutDependencies(overrides: Omit<CheckoutDependencies, "now" | "randomCredential">): CheckoutDependencies {
  return { ...overrides, now: () => new Date(), randomCredential: () => randomBytes(32) };
}

export async function paymentFirstCheckout(input: {
  enabled: string | undefined; body: unknown; cookie?: string; production: boolean; configuredOrigin?: string;
}, deps: CheckoutDependencies): Promise<CheckoutResult> {
  if (input.enabled !== "true") return error(503, "Payment-first Checkout is not active", "PAYMENT_FIRST_CHECKOUT_V2_DISABLED");
  const request = parseCheckoutBody(input.body);
  if (!request) return error(400, "Invalid Checkout request", "INVALID_CHECKOUT_REQUEST");
  const origin = trustedOrigin(input.configuredOrigin, input.production);
  if (!origin) return serverError();
  let claim;
  try { claim = credential(input.cookie, deps); } catch { return serverError(); }
  const cookie = { name: PAYMENT_V2_COOKIE, value: claim.encoded, httpOnly: true as const, sameSite: "lax" as const,
    secure: input.production, path: "/" as const, maxAge: PAYMENT_V2_COOKIE_MAX_AGE };

  try {
    const tiers = await deps.loadTier(request.tierName);
    if (tiers.length !== 1 || tiers[0].name !== request.tierName || tiers[0].is_active !== true ||
        tiers[0].stripe_price_id !== LOCKED_PAYMENT_V2_PRICES[request.tierName]) return serverError();
    const priceId = tiers[0].stripe_price_id.trim();
    const expiresAt = new Date(deps.now().getTime() + PAYMENT_V2_HOLD_MINUTES * 60_000).toISOString();
    let hold: Hold;
    try { hold = await deps.acquireHold(claim.hash, request.tierName, expiresAt, request.referralCode ?? null); }
    catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      if (code.includes("sold_out")) return { ...error(409, "This tier is sold out", "TIER_SOLD_OUT"), cookie };
      if (code.includes("effective_hold_conflict")) return { ...error(409, "A different tier is already reserved", "EFFECTIVE_HOLD_CONFLICT"), cookie };
      if (code.includes("attribution_conflict")) return { ...error(409, "This Checkout hold has different referral attribution", "REFERRAL_ATTRIBUTION_CONFLICT"), cookie };
      if (code.includes("invalid_referral")) return { ...error(400, "Referral code is invalid or unavailable", "INVALID_REFERRAL_CODE"), cookie };
      if (code.includes("invalid_request")) return { ...error(400, "Invalid Checkout request", "INVALID_CHECKOUT_REQUEST"), cookie };
      return { ...serverError(), cookie };
    }

    const authoritativeExpirationMs = Date.parse(hold.expiresAt);
    if (!Number.isFinite(authoritativeExpirationMs) || authoritativeExpirationMs <= deps.now().getTime())
      return { ...serverError(), cookie };

    if (hold.state === "SESSION_ASSOCIATED") {
      const id = await deps.loadAssociatedSessionId(hold.holdId, claim.hash);
      if (!id) return { ...serverError(), cookie };
      const existing = await deps.retrieveSession(id);
      if (!safeSession(existing, hold.holdId, request.tierName, deps.now())) return { ...serverError(), cookie };
      return { status: 200, body: { url: existing.url! }, cookie };
    }
    if (hold.state !== "HELD") return { ...serverError(), cookie };

    const metadata = { payment_v2_hold_id: hold.holdId, tier_name: request.tierName,
      checkout_contract_version: PAYMENT_V2_CONTRACT_VERSION };
    const remainingMs = authoritativeExpirationMs - deps.now().getTime();
    if (remainingMs < 30 * 60_000) return { ...error(409, "Checkout hold is too close to expiry", "HOLD_TOO_CLOSE_TO_EXPIRY"), cookie };
    if (remainingMs > 24 * 60 * 60_000) return { ...serverError(), cookie };
    const params: Record<string, unknown> = {
      mode: request.tierName === "og_throne" ? "payment" : "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/billing/cancel`, metadata,
      expires_at: Math.floor(authoritativeExpirationMs / 1000),
    };
    if (request.tierName === "og_throne") {
      params.customer_creation = "always";
      const unitAmount = hold.connectDestination ? await deps.loadPriceUnitAmount?.(priceId) : null;
      if (hold.connectDestination && (!Number.isInteger(unitAmount) || unitAmount! < 0)) return { ...serverError(), cookie };
      params.payment_intent_data = hold.connectDestination && hold.commissionPercent != null
        ? { metadata, transfer_data: { destination: hold.connectDestination }, application_fee_amount: Math.round(unitAmount! * (100 - hold.commissionPercent) / 100) }
        : { metadata };
    } else {
      params.subscription_data = hold.connectDestination && hold.commissionPercent != null
        ? { metadata, transfer_data: { destination: hold.connectDestination }, application_fee_percent: 100 - hold.commissionPercent }
        : { metadata };
    }
    const idempotencyKey = `payment-v2:${PAYMENT_V2_CONTRACT_VERSION}:hold:${hold.holdId}`;
    const session = await deps.createSession(params, idempotencyKey);
    if (!session.id || !session.url) return { ...serverError(), cookie };
    const associated = await deps.associateSession(hold.holdId, claim.hash, session.id);
    if (associated !== "associated" && associated !== "already_associated") return { ...serverError(), cookie };
    return { status: 200, body: { url: session.url }, cookie };
  } catch {
    return { ...serverError(), cookie };
  }
}
