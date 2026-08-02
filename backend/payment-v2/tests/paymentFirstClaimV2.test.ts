import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { paymentFirstClaim, paymentFirstClaimStatus, purchaserHash, type ClaimDatabase, type Hold, type Purchase, type Allocation, type Entitlement } from "../../../lib/payment-v2/claimService";

let assertions = 0;
const equal = (a: unknown, b: unknown, message: string) => { assert.deepEqual(a, b, message); assertions++; };
const check = (a: unknown, message: string) => { assert.ok(a, message); assertions++; };
const raw = Buffer.alloc(32, 4), cookie = raw.toString("base64url"), digest = createHash("sha256").update(raw).digest();
const ids = { hold: "10000000-0000-4000-8000-000000000001", purchase: "10000000-0000-4000-8000-000000000002", profile: "10000000-0000-4000-8000-000000000003", user: "10000000-0000-4000-8000-000000000004", entitlement: "10000000-0000-4000-8000-000000000005" };
const sid = "cs_test_exact";

function harness(options: { holdState?: string; purchaseState?: string | null; allocation?: boolean; entitlement?: boolean; entitlementStatus?: string; profileCount?: number; rpcResult?: string } = {}) {
  let holdState = options.holdState || "PAID_UNCLAIMED";
  let purchaseState = options.purchaseState === undefined ? "PAID_UNCLAIMED" : options.purchaseState;
  let allocation = options.allocation ?? purchaseState === "CLAIMED";
  let entitlement = options.entitlement ?? allocation;
  const calls = { body: 0, cookie: 0, db: 0, auth: 0, rpc: [] as any[], writes: 0, stripe: 0 };
  const hold = (): Hold => ({ id: ids.hold, purchaser_credential_hash: digest, tier: "og_throne", state: holdState, stripe_checkout_session_id: sid });
  const purchase = (): Purchase => ({ id: ids.purchase, hold_id: ids.hold, purchaser_credential_hash: digest, tier: "og_throne", state: purchaseState!, stripe_checkout_session_id: sid, claimed_profile_id: purchaseState === "CLAIMED" ? ids.profile : null });
  const alloc = (): Allocation => ({ purchase_id: ids.purchase, tier: "og_throne", profile_id: ids.profile, entitlement_id: ids.entitlement });
  const ent = (): Entitlement => ({ id: ids.entitlement, user_id: ids.profile, tier_name: "og_throne", status: options.entitlementStatus || "active" });
  const db: ClaimDatabase = {
    async loadHolds() { return [hold()]; }, async loadPurchases() { return purchaseState ? [purchase()] : []; },
    async loadAllocations() { return allocation ? [alloc()] : []; }, async loadEntitlements() { return entitlement ? [ent()] : []; },
    async loadProfiles() { return Array.from({ length: options.profileCount ?? 1 }, () => ({ id: ids.profile, user_id: ids.user })); },
    async claim(args) { calls.rpc.push(args); if (options.rpcResult) return options.rpcResult; purchaseState = "CLAIMED"; holdState = "CLAIMED"; if (options.allocation === undefined) allocation = true; if (options.entitlement === undefined) entitlement = true; return calls.rpc.length === 1 ? "claimed" : "already_claimed"; },
  };
  const input = (enabled: string | undefined = "true") => ({ enabled, production: true, configuredOrigin: "https://sirensforge.test", readOrigin: () => "https://sirensforge.test",
    readSessionId: () => { calls.body++; return sid; }, readCookie: () => { calls.cookie++; return cookie; },
    getAuthenticatedUser: async () => { calls.auth++; return ids.user; }, createDatabase: () => { calls.db++; return db; } });
  return { calls, db, input };
}

for (const gate of [undefined, "", "TRUE", " true", "true ", "1"]) {
  const h = harness(); const gated = { ...h.input(), enabled: gate }; equal((await paymentFirstClaimStatus(gated)).status, 503, `GET gate rejects ${String(gate)}`); equal([h.calls.body, h.calls.cookie, h.calls.db], [0, 0, 0], "GET gate precedes reads");
  equal((await paymentFirstClaim(gated)).status, 503, `POST gate rejects ${String(gate)}`); equal([h.calls.body, h.calls.cookie, h.calls.auth, h.calls.db], [0, 0, 0, 0], "POST gate precedes dependencies");
}
equal((await paymentFirstClaimStatus(harness().input("true"))).status, 200, "exact lowercase true enables");

for (const bad of [undefined, "", "cs bad", "x", `cs_${"a".repeat(253)}`]) {
  const h = harness(); const result = await paymentFirstClaimStatus({ ...h.input(), readSessionId: () => bad }); equal(result.status, 400, "invalid Session rejected");
}
for (const bad of [undefined, "bad", Buffer.alloc(31).toString("base64url"), `${cookie}=`]) {
  const h = harness(); const result = await paymentFirstClaimStatus({ ...h.input(), readCookie: () => bad }); equal(result.status, 400, "invalid credential rejected");
}
equal(purchaserHash(cookie)?.length, 32, "credential hashes to 32 bytes"); equal(purchaserHash(cookie), digest, "credential uses SHA-256");

{
  const processing = harness({ holdState: "SESSION_ASSOCIATED", purchaseState: null }); equal((await paymentFirstClaimStatus(processing.input())).body.status, "processing", "associated hold is processing");
  const paid = harness(); equal((await paymentFirstClaimStatus(paid.input())).body.status, "paid_unclaimed", "paid purchase is unclaimed"); equal(paid.calls.rpc.length, 0, "status makes zero RPC calls"); equal(paid.calls.stripe, 0, "status makes zero Stripe calls");
  const claimed = harness({ holdState: "CLAIMED", purchaseState: "CLAIMED" }); equal((await paymentFirstClaimStatus(claimed.input())).body.status, "claimed", "verified allocation is claimed");
  for (const state of ["EXPIRED_UNPAID", "CANCELED_UNPAID"]) equal((await paymentFirstClaimStatus(harness({ holdState: state, purchaseState: null }).input())).body.status, "unavailable", `${state} sanitized`);
  for (const state of ["REFUNDED", "REVOKED"]) equal((await paymentFirstClaimStatus(harness({ holdState: state, purchaseState: state }).input())).body.status, "unavailable", `${state} sanitized`);
  const missing = harness(); missing.db.loadHolds = async () => []; equal((await paymentFirstClaimStatus(missing.input())).body.status, "not_found", "no exact association is not found");
  const duplicate = harness();
  const row = (await harness().db.loadHolds(sid, digest))[0]; duplicate.db.loadHolds = async () => [row, row]; equal((await paymentFirstClaimStatus(duplicate.input())).status, 500, "duplicate hold fails closed");
}

{
  const unauth = harness(); equal((await paymentFirstClaim({ ...unauth.input(), getAuthenticatedUser: async () => null })).body.code, "PAYMENT_V2_AUTH_REQUIRED", "unauthenticated is stable 401");
  const missing = harness({ profileCount: 0 }); const missingResult = await paymentFirstClaim(missing.input()); equal(missingResult.status, 409, "missing profile conflicts"); equal(missingResult.body.code, "PAYMENT_V2_PROFILE_NOT_READY", "profile-not-ready code");
  equal((await paymentFirstClaim(harness({ profileCount: 2 }).input())).status, 500, "duplicate profile fails closed");
  equal((await paymentFirstClaim({ ...harness().input(), readOrigin: () => null })).status, 400, "missing Origin fails");
  equal((await paymentFirstClaim({ ...harness().input(), readOrigin: () => "https://evil.test" })).status, 400, "mismatched Origin fails");
  const spoof = harness(); equal((await paymentFirstClaim({ ...spoof.input(), host: "evil", forwarded: "evil" } as any)).status, 200, "request host headers ignored");
}

{
  const h = harness(); const result = await paymentFirstClaim(h.input()); equal(result, { status: 200, body: { status: "claimed" }, clearCookie: true }, "first claim succeeds and clears cookie");
  equal(h.calls.rpc.length, 1, "RPC called once"); const args = h.calls.rpc[0]; equal(args.p_purchase_id, ids.purchase, "server purchase reaches RPC"); equal(args.p_profile_id, ids.profile, "authenticated profile reaches RPC"); equal(args.p_auth_user_id, ids.user, "authenticated user reaches RPC"); equal(args.p_purchaser_hash, digest, "exact hash reaches RPC");
  const replay = await paymentFirstClaim(h.input()); equal(replay.body.status, "claimed", "exact retry succeeds"); equal(h.calls.rpc.length, 2, "retry calls idempotent RPC once"); equal(h.calls.writes, 0, "no direct ledger writes");
  equal((await paymentFirstClaim(harness({ rpcResult: "unexpected" }).input())).status, 500, "unexpected RPC result fails closed");
  for (const state of ["REFUNDED", "REVOKED"]) equal((await paymentFirstClaim(harness({ holdState: state, purchaseState: state }).input())).status, 500, `${state} cannot claim`);
  for (const options of [{ allocation: false }, { entitlement: false }, { entitlementStatus: "canceled" }]) { const bad = harness(options); const r = await paymentFirstClaim(bad.input()); equal(r.status, 500, "verification mismatch fails closed"); equal(r.clearCookie, undefined, "verification failure preserves cookie"); }
}

const route = readFileSync("app/api/payment-v2/claim/route.ts", "utf8");
check(route.includes("Object.keys(body).length === 1"), "POST accepts no extra fields"); check(!route.includes("x-forwarded"), "route ignores forwarded host headers");
const sources = [readFileSync("lib/payment-v2/claimService.ts", "utf8"), route, readFileSync("app/api/payment-v2/claim-status/route.ts", "utf8")].join("\n");
for (const forbidden of ["payment_v2_record_paid", "payment_v2_record_session_unpaid_terminal", "payment_v2_expire_unpaid", "payment_v2_acquire_hold", "payment_v2_associate_session", "stripe.checkout", ".insert(", ".delete("]) check(!sources.includes(forbidden), `no prohibited operation ${forbidden}`);
const databaseSource = readFileSync("app/api/payment-v2/claim/routeDatabase.ts", "utf8"); check(!databaseSource.includes(".update("), "database adapter performs no direct update");
const safe = JSON.stringify((await paymentFirstClaimStatus(harness().input())).body); check(!safe.includes(cookie), "raw credential absent from response"); check(!safe.includes(digest.toString("hex")), "hash absent from response");
console.log(`PFC-05 payment-first Claim V2 tests passed (${assertions} assertions; no external network calls)`);
