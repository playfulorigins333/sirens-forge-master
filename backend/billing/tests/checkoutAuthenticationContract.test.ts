import assert from "node:assert/strict";
import { createCancellationHandler, createCheckoutHandler, type CancellationDependencies, type CheckoutDependencies } from "../../../app/api/checkout/subscription/route";

let assertions = 0;
const equal = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); assertions += 1; };
const request = (body: unknown) => new Request("https://sirens.test/api/checkout/subscription", { method: "POST", body: JSON.stringify(body) });
type State = { released: number; associated: number; sessionInputs: any[]; keys: string[]; sessionCache: Map<string, any> };

function dependencies(overrides: Partial<CheckoutDependencies> = {}, state?: State): CheckoutDependencies {
  const s = state || { released: 0, associated: 0, sessionInputs: [], keys: [], sessionCache: new Map() };
  return {
    authenticate: async () => ({ id: "auth-user", email: "buyer@sirens.test" }),
    privileged: async () => ({
      profiles: async () => [{ id: "profile-1", user_id: "auth-user" }],
      tier: async () => ({ is_active: true }), entitlements: async () => [],
      reserve: async () => ({ reservation_id: "reservation-1", expires_at: "2030-01-02T03:04:05.000Z" }),
      release: async () => { s.released += 1; }, associate: async () => { s.associated += 1; },
      referral: async () => ({ code: null, affiliateUserId: null, commissionPercent: 0, destination: null, connectOnboarded: false, payable: false }),
    }),
    configuration: () => ({ priceId: "price_authoritative", baseUrl: "https://sirens.test" }),
    customer: async () => "cus_authoritative", retrievePrice: async () => ({ unitAmount: 133300 }),
    createSession: async (input, key) => {
      s.sessionInputs.push(input); s.keys.push(key);
      if (!s.sessionCache.has(key)) s.sessionCache.set(key, { id: "cs_effective", url: "https://checkout.stripe.com/effective" });
      return s.sessionCache.get(key);
    },
    ...overrides,
  };
}

let privileged = 0, stripe = 0;
let response = await createCheckoutHandler(dependencies({ authenticate: async () => null, privileged: async () => { privileged += 1; throw new Error(); }, createSession: async () => { stripe += 1; throw new Error(); } }))(request({ tier: "og_throne" }));
equal(response.status, 401); equal(privileged, 0); equal(stripe, 0);
for (const tier of ["prime_access", "Standard", "Starter Hit", "unknown"]) {
  response = await createCheckoutHandler(dependencies())(request({ tierName: tier, profileId: "evil", priceId: "evil" })); equal(response.status, 400);
}
response = await createCheckoutHandler(dependencies({ privileged: async () => ({ ...await dependencies().privileged(), profiles: async () => [] }) }))(request({ tierName: "og_throne" })); equal(response.status, 403);
response = await createCheckoutHandler(dependencies({ privileged: async () => ({ ...await dependencies().privileged(), profiles: async () => [{ id: "a", user_id: "auth-user" }, { id: "b", user_id: "auth-user" }] }) }))(request({ tierName: "og_throne" })); equal(response.status, 403);
response = await createCheckoutHandler(dependencies({ privileged: async () => ({ ...await dependencies().privileged(), tier: async () => ({ is_active: false }) }) }))(request({ tierName: "og_throne" })); equal(response.status, 409);
response = await createCheckoutHandler(dependencies({ privileged: async () => ({ ...await dependencies().privileged(), entitlements: async () => [{ status: "active", tier_name: "early_bird" }] }) }))(request({ tierName: "og_throne" })); equal(response.status, 409);

const connectState: State = { released: 0, associated: 0, sessionInputs: [], keys: [], sessionCache: new Map() };
const payable = dependencies({}, connectState); const payableDb = await payable.privileged();
payable.privileged = async () => ({ ...payableDb, referral: async () => ({ code: "FRIEND", affiliateUserId: "affiliate-server", commissionPercent: 125, destination: "acct_server", connectOnboarded: true, payable: true }) });
response = await createCheckoutHandler(payable)(request({ tierName: "og_throne", referralCode: " friend ", affiliateUserId: "evil", commissionPercent: 1, destination: "acct_evil", split: 99 }));
equal(response.status, 200);
const og = connectState.sessionInputs[0];
equal(og.customer, "cus_authoritative"); equal(og.line_items[0].price, "price_authoritative"); equal(og.mode, "payment");
equal(og.expires_at, 1893553445); equal(og.payment_intent_data.application_fee_amount, 0); // clamped 100% commission
equal(og.payment_intent_data.transfer_data.destination, "acct_server"); equal(og.metadata.affiliate_user_id, "affiliate-server");
for (const field of ["user_id", "profile_id", "tier_name", "stripe_price_id", "reservation_id", "referral_code", "affiliate_user_id", "commission_percent", "platform_fee_percent", "connect_destination_account", "connect_onboarded", "type", "connect_mode"]) equal(typeof og.metadata[field], "string");
equal(og.metadata.connect_mode, "destination_charge"); equal(og.payment_intent_data.metadata, og.metadata);
equal(og.success_url, "https://sirens.test/pricing?checkout=success&tier=og_throne"); equal(og.cancel_url.includes("/pricing?checkout=canceled"), true);

const subscriptionState: State = { released: 0, associated: 0, sessionInputs: [], keys: [], sessionCache: new Map() };
const subscription = dependencies({}, subscriptionState); const subscriptionDb = await subscription.privileged();
subscription.privileged = async () => ({ ...subscriptionDb, referral: async () => ({ code: "FRIEND", affiliateUserId: "affiliate-server", commissionPercent: 20, destination: "acct_server", connectOnboarded: true, payable: true }) });
response = await createCheckoutHandler(subscription)(request({ tierName: "early_bird", commissionPercent: 99, destination: "acct_evil" }));
equal(response.status, 200); const connectedSubscription = subscriptionState.sessionInputs[0];
equal(connectedSubscription.subscription_data.application_fee_percent, 80); equal(connectedSubscription.subscription_data.transfer_data.destination, "acct_server");
equal(connectedSubscription.subscription_data.metadata.connect_mode, "destination_charge");

const plainState: State = { released: 0, associated: 0, sessionInputs: [], keys: [], sessionCache: new Map() };
response = await createCheckoutHandler(dependencies({}, plainState))(request({ tierName: "early_bird", destination: "acct_evil", commissionPercent: 99 }));
equal(response.status, 200); const early = plainState.sessionInputs[0]; equal(early.subscription_data.transfer_data, undefined); equal(early.metadata.connect_mode, "none"); equal(early.subscription_data.metadata, early.metadata);

const releaseState: State = { released: 0, associated: 0, sessionInputs: [], keys: [], sessionCache: new Map() };
response = await createCheckoutHandler(dependencies({ configuration: () => ({ priceId: "", baseUrl: "" }) }, releaseState))(request({ tierName: "og_throne" })); equal(response.status, 503); equal(releaseState.released, 1);
response = await createCheckoutHandler(dependencies({ createSession: async () => { throw new Error("provider secret"); } }, releaseState))(request({ tierName: "og_throne" })); equal(response.status, 502); equal(releaseState.released, 2); equal((await response.text()).includes("secret"), false);

const retryState: State = { released: 0, associated: 0, sessionInputs: [], keys: [], sessionCache: new Map() };
let associationAttempts = 0; const retry = dependencies({}, retryState); const retryDb = await retry.privileged();
retry.privileged = async () => ({ ...retryDb, associate: async () => { associationAttempts += 1; if (associationAttempts === 1) throw new Error("db detail"); retryState.associated += 1; } });
response = await createCheckoutHandler(retry)(request({ tierName: "og_throne" })); equal(response.status, 503); equal(retryState.released, 0);
response = await createCheckoutHandler(retry)(request({ tierName: "og_throne" })); equal(response.status, 200); equal(retryState.released, 0);
equal(retryState.keys[0], retryState.keys[1]); equal(retryState.sessionCache.size, 1); equal(retryState.sessionInputs[0].expires_at, retryState.sessionInputs[1].expires_at);

const cancellationRequest = (body: unknown) => new Request("https://sirens.test/api/checkout/subscription", { method: "DELETE", body: JSON.stringify(body) });
type CancellationState = { lookups: unknown[][]; released: number; retrieved: string[]; expired: string[]; order: string[] };
function cancellationDependencies(
  reservation: { reservation_id: string; status: string; stripe_session_id: string | null } | null,
  session: { status: string; paymentStatus: string } = { status: "open", paymentStatus: "unpaid" },
  overrides: Partial<CancellationDependencies> = {},
) {
  const state: CancellationState = { lookups: [], released: 0, retrieved: [], expired: [], order: [] };
  const deps: CancellationDependencies = {
    authenticate: async () => ({ id: "auth-user" }),
    privileged: async () => ({
      profiles: async () => [{ id: "profile-1", user_id: "auth-user" }],
      reservations: async (profileId, tier, reservationId) => { state.lookups.push([profileId, tier, reservationId]); return reservation ? [reservation] : []; },
      release: async () => { state.order.push("release"); state.released += 1; },
    }),
    retrieveSession: async (sessionId) => { state.order.push("retrieve"); state.retrieved.push(sessionId); return session; },
    expireSession: async (sessionId) => { state.order.push("expire"); state.expired.push(sessionId); return { status: "expired", paymentStatus: "unpaid" }; },
    ...overrides,
  };
  return { deps, state };
}

let cancellation = cancellationDependencies({ reservation_id: "reservation-owned", status: "active", stripe_session_id: null });
response = await createCancellationHandler(cancellation.deps)(cancellationRequest({ tier: "og_throne", reservation: "reservation-owned", stripe_session_id: "cs_browser_evil" }));
equal(response.status, 200); equal(cancellation.state.released, 1); equal(cancellation.state.retrieved, []);
equal(cancellation.state.lookups, [["profile-1", "og_throne", "reservation-owned"]]);

cancellation = cancellationDependencies({ reservation_id: "reservation-owned", status: "associated", stripe_session_id: "cs_server_stored" });
response = await createCancellationHandler(cancellation.deps)(cancellationRequest({ tier: "og_throne", reservation: "reservation-owned", stripe_session_id: "cs_browser_evil" }));
equal(response.status, 200); equal(cancellation.state.retrieved, ["cs_server_stored"]); equal(cancellation.state.expired, ["cs_server_stored"]);
equal(cancellation.state.order, ["retrieve", "expire", "release"]); equal(cancellation.state.released, 1);

cancellation = cancellationDependencies({ reservation_id: "reservation-owned", status: "associated", stripe_session_id: "cs_server_stored" }, { status: "open", paymentStatus: "unpaid" }, { expireSession: async () => { throw new Error("raw Stripe secret"); } });
response = await createCancellationHandler(cancellation.deps)(cancellationRequest({ tier: "og_throne", reservation: "reservation-owned" }));
equal(response.status, 503); equal(cancellation.state.released, 0); equal((await response.text()).includes("secret"), false);

cancellation = cancellationDependencies({ reservation_id: "reservation-owned", status: "associated", stripe_session_id: "cs_expired" }, { status: "expired", paymentStatus: "unpaid" });
response = await createCancellationHandler(cancellation.deps)(cancellationRequest({ tier: "og_throne", reservation: "reservation-owned" }));
equal(response.status, 200); equal(cancellation.state.expired, []); equal(cancellation.state.released, 1);

cancellation = cancellationDependencies({ reservation_id: "reservation-owned", status: "released", stripe_session_id: "cs_previously_expired" });
response = await createCancellationHandler(cancellation.deps)(cancellationRequest({ tier: "og_throne", reservation: "reservation-owned" }));
equal(response.status, 200); equal(cancellation.state.retrieved, []); equal(cancellation.state.released, 0);

for (const paid of [{ status: "complete", paymentStatus: "unpaid" }, { status: "complete", paymentStatus: "paid" }, { status: "open", paymentStatus: "paid" }]) {
  cancellation = cancellationDependencies({ reservation_id: "reservation-owned", status: "associated", stripe_session_id: "cs_paid" }, paid);
  response = await createCancellationHandler(cancellation.deps)(cancellationRequest({ tier: "early_bird", reservation: "reservation-owned" }));
  equal(response.status, 202); equal(cancellation.state.released, 0); equal(cancellation.state.expired, []);
}

cancellation = cancellationDependencies(null);
response = await createCancellationHandler(cancellation.deps)(cancellationRequest({ tier: "og_throne", reservation: "missing" })); equal(response.status, 503); equal(cancellation.state.released, 0);
const ambiguous = cancellationDependencies(null); const ambiguousDb = await ambiguous.deps.privileged();
ambiguous.deps.privileged = async () => ({ ...ambiguousDb, reservations: async () => [
  { reservation_id: "reservation-owned", status: "active", stripe_session_id: null },
  { reservation_id: "reservation-owned", status: "active", stripe_session_id: null },
] });
response = await createCancellationHandler(ambiguous.deps)(cancellationRequest({ tier: "og_throne", reservation: "reservation-owned" })); equal(response.status, 503); equal(ambiguous.state.released, 0);

const otherProfile = cancellationDependencies(null); const otherDb = await otherProfile.deps.privileged();
otherProfile.deps.privileged = async () => ({ ...otherDb, reservations: async (profileId, tier, reservationId) => { otherProfile.state.lookups.push([profileId, tier, reservationId]); return []; } });
response = await createCancellationHandler(otherProfile.deps)(cancellationRequest({ tier: "og_throne", reservation: "other-reservation", stripe_session_id: "cs_other" }));
equal(response.status, 503); equal(otherProfile.state.released, 0); equal(otherProfile.state.retrieved, []);

const databaseFailure = cancellationDependencies(null, undefined, { privileged: async () => { throw new Error("raw database SQL"); } });
response = await createCancellationHandler(databaseFailure.deps)(cancellationRequest({ tier: "og_throne", reservation: "reservation-owned" }));
equal(response.status, 503); equal((await response.text()).includes("database"), false);
console.log(`checkoutAuthenticationContract: ${assertions} assertions passed`);
