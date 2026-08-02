import { createHash } from "node:crypto";

export const PAYMENT_V2_CLAIM_COOKIE = "sf_payment_v2_claim";
export type ClaimResponse = { status: number; body: Record<string, string>; clearCookie?: true };
export type Hold = { id: string; purchaser_credential_hash: string | Uint8Array; tier: string; state: string; stripe_checkout_session_id: string | null };
export type Purchase = { id: string; hold_id: string; purchaser_credential_hash: string | Uint8Array; tier: string; state: string; stripe_checkout_session_id: string; claimed_profile_id: string | null };
export type Allocation = { purchase_id: string; tier: string; profile_id: string; entitlement_id: string };
export type Entitlement = { id: string; user_id: string; tier_name: string; status: string };
export type Profile = { id: string; user_id: string };

export interface ClaimDatabase {
  loadHolds(sessionId: string, hash: Uint8Array): Promise<Hold[]>;
  loadPurchases(holdId: string, sessionId: string, hash: Uint8Array): Promise<Purchase[]>;
  loadAllocations(purchaseId: string): Promise<Allocation[]>;
  loadEntitlements(entitlementId: string): Promise<Entitlement[]>;
  loadProfiles(userId: string): Promise<Profile[]>;
  claim(args: { p_purchase_id: string; p_purchaser_hash: Uint8Array; p_profile_id: string; p_auth_user_id: string }): Promise<string>;
}

export interface ClaimInput {
  enabled?: string;
  production: boolean;
  configuredOrigin?: string;
  readSessionId(): Promise<unknown> | unknown;
  readCookie(): string | undefined;
  readOrigin?(): string | null;
  getAuthenticatedUser?(): Promise<string | null>;
  createDatabase(): ClaimDatabase;
}

const response = (status: number, body: Record<string, string>): ClaimResponse => ({ status, body });
const disabled = () => response(503, { error: "Payment-first claiming is not active", code: "PAYMENT_FIRST_CLAIM_V2_DISABLED" });
const invalid = () => response(400, { error: "Invalid claim request", code: "INVALID_PAYMENT_V2_CLAIM_REQUEST" });
const failed = () => response(500, { error: "Unable to process claim", code: "PAYMENT_FIRST_CLAIM_V2_ERROR" });

function sessionId(value: unknown): string | null {
  return typeof value === "string" && value.length <= 255 && /^cs_[A-Za-z0-9_\-]+$/.test(value) ? value : null;
}

export function purchaserHash(value: string | undefined): Uint8Array | null {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const raw = Buffer.from(value, "base64url");
  if (raw.length !== 32 || raw.toString("base64url") !== value) return null;
  return createHash("sha256").update(raw).digest();
}

function hash(value: string | Uint8Array): Buffer | null {
  if (value instanceof Uint8Array) return value.length === 32 ? Buffer.from(value) : null;
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  return /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, "hex") : null;
}

function exactHold(row: Hold, sid: string, expected: Uint8Array) {
  const stored = hash(row.purchaser_credential_hash);
  return stored?.equals(Buffer.from(expected)) && row.stripe_checkout_session_id === sid && ["og_throne", "early_bird"].includes(row.tier);
}
function exactPurchase(row: Purchase, hold: Hold, sid: string, expected: Uint8Array) {
  const stored = hash(row.purchaser_credential_hash);
  return stored?.equals(Buffer.from(expected)) && row.hold_id === hold.id && row.stripe_checkout_session_id === sid && row.tier === hold.tier;
}
function exactClaimed(p: Purchase, a: Allocation, e: Entitlement, profile?: string) {
  return p.state === "CLAIMED" && !!p.claimed_profile_id && a.purchase_id === p.id && a.profile_id === p.claimed_profile_id &&
    (!profile || a.profile_id === profile) && a.tier === p.tier && e.id === a.entitlement_id && e.user_id === a.profile_id &&
    e.tier_name === p.tier && ["active", "trialing"].includes(e.status);
}

function trustedOrigin(configured: string | undefined, production: boolean): string | null {
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if ((production && url.protocol !== "https:") || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/+$/, "")) return null;
    return url.origin;
  } catch { return null; }
}

async function resolve(input: ClaimInput) {
  const sid = sessionId(await input.readSessionId());
  if (!sid) return { error: invalid() } as const;
  const credential = purchaserHash(input.readCookie());
  if (!credential) return { error: invalid() } as const;
  return { sid, credential, db: input.createDatabase() } as const;
}

export async function paymentFirstClaimStatus(input: ClaimInput): Promise<ClaimResponse> {
  if (input.enabled !== "true") return disabled();
  try {
    const resolved = await resolve(input); if ("error" in resolved) return resolved.error;
    const holds = await resolved.db.loadHolds(resolved.sid, resolved.credential);
    if (holds.length === 0) return response(200, { status: "not_found" });
    if (holds.length !== 1 || !exactHold(holds[0], resolved.sid, resolved.credential)) return failed();
    const hold = holds[0];
    const purchases = await resolved.db.loadPurchases(hold.id, resolved.sid, resolved.credential);
    if (purchases.length > 1 || (purchases[0] && !exactPurchase(purchases[0], hold, resolved.sid, resolved.credential))) return failed();
    if (!purchases[0]) {
      if (hold.state === "SESSION_ASSOCIATED") return response(200, { status: "processing" });
      if (["EXPIRED_UNPAID", "CANCELED_UNPAID"].includes(hold.state)) return response(200, { status: "unavailable" });
      return failed();
    }
    const purchase = purchases[0];
    if (["REFUNDED", "REVOKED"].includes(purchase.state)) return purchase.state === hold.state ? response(200, { status: "unavailable" }) : failed();
    const allocations = await resolved.db.loadAllocations(purchase.id);
    if (purchase.state === "PAID_UNCLAIMED" && allocations.length === 0 && hold.state === "PAID_UNCLAIMED") return response(200, { status: "paid_unclaimed" });
    if (purchase.state !== "CLAIMED" || hold.state !== "CLAIMED" || allocations.length !== 1) return failed();
    const entitlements = await resolved.db.loadEntitlements(allocations[0].entitlement_id);
    return entitlements.length === 1 && exactClaimed(purchase, allocations[0], entitlements[0]) ? response(200, { status: "claimed" }) : failed();
  } catch { return failed(); }
}

export async function paymentFirstClaim(input: ClaimInput): Promise<ClaimResponse> {
  if (input.enabled !== "true") return disabled();
  const expected = trustedOrigin(input.configuredOrigin, input.production);
  if (!expected || input.readOrigin?.() !== expected) return invalid();
  try {
    const resolved = await resolve(input); if ("error" in resolved) return resolved.error;
    const userId = await input.getAuthenticatedUser?.();
    if (!userId) return response(401, { error: "Authentication required", code: "PAYMENT_V2_AUTH_REQUIRED" });
    const profiles = await resolved.db.loadProfiles(userId);
    if (profiles.length === 0) return response(409, { error: "Profile is not ready", code: "PAYMENT_V2_PROFILE_NOT_READY" });
    if (profiles.length !== 1 || profiles[0].user_id !== userId) return failed();
    const holds = await resolved.db.loadHolds(resolved.sid, resolved.credential);
    if (holds.length !== 1 || !exactHold(holds[0], resolved.sid, resolved.credential)) return failed();
    const purchases = await resolved.db.loadPurchases(holds[0].id, resolved.sid, resolved.credential);
    if (purchases.length !== 1 || !exactPurchase(purchases[0], holds[0], resolved.sid, resolved.credential) || !["PAID_UNCLAIMED", "CLAIMED"].includes(purchases[0].state) || purchases[0].state !== holds[0].state) return failed();
    const purchase = purchases[0], profile = profiles[0];
    if (purchase.state === "CLAIMED" && purchase.claimed_profile_id !== profile.id) return failed();
    const result = await resolved.db.claim({ p_purchase_id: purchase.id, p_purchaser_hash: resolved.credential, p_profile_id: profile.id, p_auth_user_id: userId });
    if (result !== "claimed" && result !== "already_claimed") return failed();
    const verifiedPurchases = await resolved.db.loadPurchases(holds[0].id, resolved.sid, resolved.credential);
    if (verifiedPurchases.length !== 1 || !exactPurchase(verifiedPurchases[0], holds[0], resolved.sid, resolved.credential)) return failed();
    const allocations = await resolved.db.loadAllocations(purchase.id);
    if (allocations.length !== 1) return failed();
    const entitlements = await resolved.db.loadEntitlements(allocations[0].entitlement_id);
    if (entitlements.length !== 1 || !exactClaimed(verifiedPurchases[0], allocations[0], entitlements[0], profile.id)) return failed();
    return { status: 200, body: { status: "claimed" }, clearCookie: true };
  } catch { return failed(); }
}
