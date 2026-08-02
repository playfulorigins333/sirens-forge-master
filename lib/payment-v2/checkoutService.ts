import { createHash, randomBytes } from "node:crypto";

export const PAYMENT_V2_COOKIE = "sf_payment_v2_claim";
export const PAYMENT_V2_CONTRACT_VERSION = "pfc-03-v2";
export const PAYMENT_V2_HOLD_MINUTES = 60;
export const PAYMENT_V2_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

export type PaymentTier = "og_throne" | "early_bird";
type Hold = { holdId: string; state: string };
type TierRow = { name: string; is_active: boolean; stripe_price_id: string | null };
type Referral = { destination: string; commissionPercent: number } | null;
export type Session = {
  id: string; url: string | null; status?: string | null; payment_status?: string | null;
  expires_at?: number | null; metadata?: Record<string, string> | null;
};

export interface CheckoutDependencies {
  now(): Date;
  randomCredential(): Buffer;
  loadTier(name: PaymentTier): Promise<TierRow[]>;
  acquireHold(hash: Uint8Array, tier: PaymentTier, expiresAt: string): Promise<Hold>;
  loadAssociatedSessionId(holdId: string, hash: Uint8Array): Promise<string | null>;
  associateSession(holdId: string, hash: Uint8Array, sessionId: string): Promise<string>;
  resolveReferral(code: string): Promise<Referral>;
  retrievePriceUnitAmount(priceId: string): Promise<number | null>;
  createSession(params: Record<string, unknown>, idempotencyKey: string): Promise<Session>;
  retrieveSession(id: string): Promise<Session>;
}

export type CheckoutResult = {
  status: number;
  body: Record<string, string>;
  cookie?: { name: string; value: string; httpOnly: true; sameSite: "lax"; secure: boolean; path: "/"; maxAge: number };
};

const error = (status: number, message: string, code: string): CheckoutResult => ({ status, body: { error: message, code } });
const serverError = () => error(500, "Unable to start Checkout", "PAYMENT_FIRST_CHECKOUT_V2_ERROR");

function parseBody(body: unknown): { tierName: PaymentTier; referralCode?: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (!Object.keys(record).every((key) => key === "tierName" || key === "referralCode")) return null;
  if (record.tierName !== "og_throne" && record.tierName !== "early_bird") return null;
  if (record.referralCode !== undefined && typeof record.referralCode !== "string") return null;
  const referralCode = typeof record.referralCode === "string" ? record.referralCode.trim().toUpperCase() : "";
  if (referralCode.length > 64 || (referralCode && !/^[A-Z0-9_-]+$/.test(referralCode))) return null;
  return referralCode ? { tierName: record.tierName, referralCode } : { tierName: record.tierName };
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

export function defaultCheckoutDependencies(overrides: Omit<CheckoutDependencies, "now" | "randomCredential">): CheckoutDependencies {
  return { ...overrides, now: () => new Date(), randomCredential: () => randomBytes(32) };
}

export async function paymentFirstCheckout(input: {
  enabled: string | undefined; body: unknown; cookie?: string; production: boolean; baseUrl: string;
}, deps: CheckoutDependencies): Promise<CheckoutResult> {
  if (input.enabled !== "true") return error(503, "Payment-first Checkout is not active", "PAYMENT_FIRST_CHECKOUT_V2_DISABLED");
  const request = parseBody(input.body);
  if (!request) return error(400, "Invalid Checkout request", "INVALID_CHECKOUT_REQUEST");
  if (!input.baseUrl) return serverError();

  let claim;
  try { claim = credential(input.cookie, deps); } catch { return serverError(); }
  const cookie = { name: PAYMENT_V2_COOKIE, value: claim.encoded, httpOnly: true as const, sameSite: "lax" as const,
    secure: input.production, path: "/" as const, maxAge: PAYMENT_V2_COOKIE_MAX_AGE };

  try {
    const tiers = await deps.loadTier(request.tierName);
    if (tiers.length !== 1 || tiers[0].name !== request.tierName || tiers[0].is_active !== true ||
        typeof tiers[0].stripe_price_id !== "string" || !tiers[0].stripe_price_id.trim()) return serverError();
    const priceId = tiers[0].stripe_price_id.trim();
    const expiresAt = new Date(deps.now().getTime() + PAYMENT_V2_HOLD_MINUTES * 60_000).toISOString();
    let hold: Hold;
    try { hold = await deps.acquireHold(claim.hash, request.tierName, expiresAt); }
    catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      if (code.includes("sold_out")) return error(409, "This tier is sold out", "TIER_SOLD_OUT");
      if (code.includes("effective_hold_conflict")) return error(409, "A different tier is already reserved", "EFFECTIVE_HOLD_CONFLICT");
      if (code.includes("invalid_request")) return error(400, "Invalid Checkout request", "INVALID_CHECKOUT_REQUEST");
      return serverError();
    }

    if (hold.state === "SESSION_ASSOCIATED") {
      const id = await deps.loadAssociatedSessionId(hold.holdId, claim.hash);
      if (!id) return { ...serverError(), cookie };
      const existing = await deps.retrieveSession(id);
      if (!safeSession(existing, hold.holdId, request.tierName, deps.now())) return { ...serverError(), cookie };
      return { status: 200, body: { url: existing.url! }, cookie };
    }
    if (hold.state !== "HELD") return { ...serverError(), cookie };

    const referral = request.referralCode ? await deps.resolveReferral(request.referralCode) : null;
    const metadata = { payment_v2_hold_id: hold.holdId, tier_name: request.tierName,
      checkout_contract_version: PAYMENT_V2_CONTRACT_VERSION };
    const params: Record<string, unknown> = {
      mode: request.tierName === "og_throne" ? "payment" : "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${input.baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${input.baseUrl}/billing/cancel`, metadata,
    };
    if (request.tierName === "og_throne") params.customer_creation = "always";
    if (referral) {
      if (!referral.destination || !/^acct_[A-Za-z0-9]+$/.test(referral.destination) ||
          !Number.isFinite(referral.commissionPercent) || referral.commissionPercent < 0 || referral.commissionPercent > 100)
        return { ...serverError(), cookie };
      if (request.tierName === "og_throne") {
        const amount = await deps.retrievePriceUnitAmount(priceId);
        if (!Number.isInteger(amount) || amount! < 0) return { ...serverError(), cookie };
        params.payment_intent_data = { application_fee_amount: Math.round(amount! * (100 - referral.commissionPercent) / 100),
          transfer_data: { destination: referral.destination }, metadata };
      } else params.subscription_data = { application_fee_percent: 100 - referral.commissionPercent,
        transfer_data: { destination: referral.destination }, metadata };
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
