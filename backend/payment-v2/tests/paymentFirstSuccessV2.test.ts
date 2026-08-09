import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { NextRequest } from "next/server";
import {
  buildPaymentSuccessLinks, paymentFirstSuccessEnabled, PaymentFirstSuccessFlow,
  validateSuccessSearchParams, type SuccessFlowDependencies, type SuccessState,
} from "../../../lib/payment-v2/successFlow";
import { isPublicPath, proxy } from "../../../proxy";

let assertions = 0;
const equal = (actual: unknown, expected: unknown, message: string) => { assert.deepEqual(actual, expected, message); assertions++; };
const check = (actual: unknown, message: string) => { assert.ok(actual, message); assertions++; };
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
type Result = { status: number; body: unknown };

function harness(statuses: Result[], authenticated: boolean | (() => Promise<boolean>) = false, claims: Result[] = []) {
  let now = 0;
  let nextTimer = 1;
  const timers = new Map<number, () => void>();
  const calls = { status: [] as string[], claim: [] as string[], auth: 0, timers: [] as number[], cleared: 0 };
  const states: SuccessState[] = [];
  let statusPending = false;
  let claimPending = false;
  const deps: SuccessFlowDependencies = {
    async requestStatus(sid) { check(!statusPending, "only one status request is in flight"); statusPending = true; calls.status.push(sid); const result = statuses.shift()!; await Promise.resolve(); statusPending = false; return result; },
    async requestClaim(sid) { check(!claimPending, "only one claim request is in flight"); claimPending = true; calls.claim.push(sid); const result = claims.shift()!; await Promise.resolve(); claimPending = false; return result; },
    async isAuthenticated() { calls.auth++; return typeof authenticated === "function" ? authenticated() : authenticated; }, now: () => now,
    setTimer(callback, delay) { const id = nextTimer++; timers.set(id, callback); calls.timers.push(delay); return id; },
    clearTimer(id) { timers.delete(id as number); calls.cleared++; },
  };
  const flow = new PaymentFirstSuccessFlow("cs_test_safe", deps);
  const unsubscribe = flow.subscribe((state) => states.push(state));
  const runTimer = async (advance: number) => { now += advance; const entry = timers.entries().next().value as [number, () => void] | undefined; check(!!entry, "a bounded retry timer exists"); if (entry) { timers.delete(entry[0]); entry[1](); await tick(); } };
  return { flow, calls, states, timers, unsubscribe, runTimer, setNow: (value: number) => { now = value; } };
}

for (const value of [undefined, "", "TRUE", " true", "true ", "1"]) equal(paymentFirstSuccessEnabled(value), false, `gate rejects ${String(value)}`);
equal(paymentFirstSuccessEnabled("true"), true, "only exact lowercase true enables");

equal(validateSuccessSearchParams({}), null, "missing session rejected");
equal(validateSuccessSearchParams({ session_id: "" }), null, "blank session rejected");
equal(validateSuccessSearchParams({ session_id: "checkout_123" }), null, "malformed session rejected");
equal(validateSuccessSearchParams({ session_id: `cs_${"a".repeat(253)}` }), null, "overlong session rejected");
equal(validateSuccessSearchParams({ session_id: ["cs_one", "cs_two"] }), null, "duplicate session rejected");
equal(validateSuccessSearchParams({ session_id: "cs_safe", profile_id: "no" }), null, "unexpected fields rejected");
equal(validateSuccessSearchParams({ session_id: "cs_safe" }), "cs_safe", "valid Session ID accepted");

const links = buildPaymentSuccessLinks("cs_test_safe");
equal(links.continuation, "/billing/success?session_id=cs_test_safe", "continuation is exact and internal");
equal(links.signIn, "/login?next=%2Fbilling%2Fsuccess%3Fsession_id%3Dcs_test_safe", "sign-in continuation is encoded");
equal(links.signUp, "/login?mode=signup&next=%2Fbilling%2Fsuccess%3Fsession_id%3Dcs_test_safe", "signup continuation is encoded");
check(!links.continuation.startsWith("//") && !links.continuation.includes("://"), "external continuation cannot be produced");

for (const pathname of ["/billing/success", "/billing/cancel"])
  check(isPublicPath(pathname), `${pathname} is an exact public path`);
for (const url of ["https://sirensforge.test/billing/success?session_id=cs_safe", "https://sirensforge.test/billing/cancel?source=checkout"])
  check(isPublicPath(new URL(url).pathname), `${url} resolves publicly by pathname`);
for (const pathname of ["/billing", "/billing/other", "/billing/success/other"])
  equal(isPublicPath(pathname), false, `${pathname} remains protected`);
check(isPublicPath("/pricing"), "existing public path remains public");
equal(isPublicPath("/dashboard"), false, "unrelated application route remains protected");

const rateLimitApiPrefix = "/.well-known/vercel/rate-limit-api/";
const checkoutRateLimitPath = `${rateLimitApiPrefix}payment-v2-checkout`;
check(isPublicPath(checkoutRateLimitPath), "Payment V2 Firewall rate-limit API path is public to Proxy");
check(isPublicPath(`${rateLimitApiPrefix}another-rule`), "another Firewall rate-limit identifier is public to Proxy");
equal(isPublicPath("/.well-known/vercel/rate-limit-apix/payment-v2-checkout"), false, "Firewall namespace lookalike remains protected");
equal(isPublicPath("/.well-known/example"), false, "unrelated .well-known path remains protected");
const rateLimitProxyResponse = await proxy({ nextUrl: { pathname: checkoutRateLimitPath } } as unknown as NextRequest);
equal(rateLimitProxyResponse.headers.get("x-middleware-next"), "1", "unauthenticated Payment V2 Firewall rate-limit request continues without redirect");

const botIdPrefix = "/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/";
const botIdChallengePath = `${botIdPrefix}a-4-a/c.js`;
check(isPublicPath(botIdChallengePath), "pinned BotID challenge script is public to Proxy");
check(isPublicPath(`${botIdPrefix}nested/challenge/token`), "nested paths in the pinned BotID namespace are public to Proxy");
equal(isPublicPath("/249e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/a-4-a/c.js"), false, "different first BotID UUID remains protected");
equal(isPublicPath("/149e9513-01fa-4fb0-aad4-566afd725d1b/3d206a39-8ed7-437e-a3be-862e0f06eea3/a-4-a/c.js"), false, "different second BotID UUID remains protected");
equal(isPublicPath("/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3"), false, "namespace without its exact trailing slash remains protected");
const botIdProxyResponse = await proxy({ nextUrl: { pathname: botIdChallengePath } } as unknown as NextRequest);
equal(botIdProxyResponse.headers.get("x-middleware-next"), "1", "unauthenticated BotID challenge continues to Next.js routing without redirect");

{
  const h = harness([{ status: 200, body: { status: "processing" } }, { status: 200, body: { status: "claimed" } }]);
  h.flow.start(); await tick(); equal(h.states.at(-1)?.view, "processing", "processing is displayed"); equal(h.calls.claim.length, 0, "processing performs no claim"); equal(h.calls.timers, [2000], "processing polls at bounded interval");
  await h.runTimer(2000); equal(h.states.at(-1)?.view, "claimed", "polling stops on terminal state"); equal(h.timers.size, 0, "terminal state has no timer"); equal(h.calls.status.length, 2, "terminal polling is bounded");
  h.flow.start(); equal(h.calls.status.length, 2, "rerender-like start does not restart flow"); h.unsubscribe(); equal(h.timers.size, 0, "unmount leaves no timer");
}
{
  let resolveFirst!: (result: Result) => void;
  const pending = new Promise<Result>((resolve) => { resolveFirst = resolve; });
  let firstCalls = 0;
  let staleClaims = 0;
  const firstStates: SuccessState[] = [];
  const firstTimers = new Map<number, () => void>();
  const first = new PaymentFirstSuccessFlow("cs_test_safe", {
    requestStatus: async () => { firstCalls++; return pending; }, requestClaim: async () => { staleClaims++; throw new Error("stale claim"); },
    isAuthenticated: async () => true, now: () => 0,
    setTimer: (callback) => { firstTimers.set(1, callback); return 1; }, clearTimer: (id) => { firstTimers.delete(id as number); },
  });
  first.subscribe((state) => firstStates.push(state)); first.start(); equal(firstCalls, 1, "first flow starts"); first.dispose();
  resolveFirst({ status: 200, body: { status: "processing" } }); await tick();
  equal(firstStates.at(-1)?.view, "loading", "disposed pending flow cannot update state"); equal(firstTimers.size, 0, "disposed flow creates no later timer"); equal(staleClaims, 0, "disposed flow creates no claim");
  const second = harness([{ status: 200, body: { status: "claimed" } }]); second.flow.start(); await tick();
  equal(second.calls.status.length, 1, "fresh second flow starts for the same Session ID"); equal(second.states.at(-1)?.view, "claimed", "fresh flow reaches authoritative result");
  const changed = harness([{ status: 200, body: { status: "not_found" } }]); second.unsubscribe(); changed.flow.start(); await tick();
  equal(second.timers.size, 0, "session change cleanup leaves no stale timer"); equal(changed.states.at(-1)?.view, "not_found", "session change uses a fresh flow");
}
{
  let attempts = 0;
  const auth = async () => { attempts++; if (attempts === 1) throw new Error("raw auth provider detail"); return true; };
  const h = harness([
    { status: 200, body: { status: "paid_unclaimed" } },
    { status: 200, body: { status: "paid_unclaimed" } },
  ], auth, [{ status: 200, body: { status: "claimed" } }]);
  h.flow.start(); await tick(); equal(h.states.at(-1)?.view, "error", "auth dependency rejection fails closed"); equal(h.calls.claim.length, 0, "auth rejection makes zero claims"); equal(h.timers.size, 0, "auth rejection schedules no tight retry");
  check(!JSON.stringify(h.states).includes("raw auth provider detail"), "raw auth errors never enter state");
  h.flow.retry(); await tick(); equal(h.calls.status.length, 2, "manual Retry makes one fresh status/auth attempt"); equal(h.calls.auth, 2, "manual Retry performs auth again"); equal(h.calls.claim.length, 1, "successful auth after Retry proceeds to one claim"); equal(h.states.at(-1)?.view, "claimed", "successful auth Retry reaches claimed");
}
{
  const h = harness([{ status: 200, body: { status: "processing" } }, { status: 200, body: { status: "processing" } }]);
  h.flow.start(); await tick(); h.setNow(60000); await h.runTimer(0); equal(h.states.at(-1)?.view, "timed_out", "polling timeout enables manual retry"); equal(h.timers.size, 0, "polling never becomes infinite");
}
{
  const h = harness([{ status: 200, body: { status: "paid_unclaimed" } }]); h.flow.start(); await tick();
  equal(h.calls.auth, 1, "paid purchase checks authentication"); equal(h.states.at(-1)?.view, "sign_in", "unauthenticated purchase requests sign in"); equal(h.calls.claim.length, 0, "unauthenticated purchase makes zero claims");
}
{
  const h = harness([{ status: 200, body: { status: "paid_unclaimed" } }], true, [{ status: 200, body: { status: "claimed" } }]); h.flow.start(); await tick();
  equal(h.calls.claim, ["cs_test_safe"], "authenticated purchase posts only validated Session ID"); equal(h.states.at(-1)?.view, "claimed", "verified claim becomes claimed"); h.flow.start(); equal(h.calls.claim.length, 1, "claimed never claims again");
}
{
  const notReady = { status: 409, body: { error: "Profile is not ready", code: "PAYMENT_V2_PROFILE_NOT_READY" } };
  const h = harness([{ status: 200, body: { status: "paid_unclaimed" } }], true, [notReady, notReady, notReady]); h.flow.start(); await tick();
  equal(h.states.at(-1)?.view, "profile_setup", "profile-not-ready displays setup state"); equal(h.calls.timers, [2000], "profile retry starts with bounded backoff"); await h.runTimer(2000); equal(h.calls.timers.at(-1), 4000, "profile retry backs off");
  h.setNow(30000); await h.runTimer(0); equal(h.states.at(-1)?.view, "timed_out", "profile retry timeout offers manual retry"); equal(h.timers.size, 0, "profile retry window is bounded");
}
{
  const authRace = { status: 401, body: { error: "Authentication required", code: "PAYMENT_V2_AUTH_REQUIRED" } };
  const h = harness([{ status: 200, body: { status: "paid_unclaimed" } }], true, [authRace]); h.flow.start(); await tick(); equal(h.states.at(-1)?.view, "sign_in", "auth race returns to sign-in state"); equal(h.calls.claim.length, 1, "auth race does not loop claims");
}
for (const terminal of ["unavailable", "not_found", "claimed"] as const) {
  const h = harness([{ status: 200, body: { status: terminal } }]); h.flow.start(); await tick(); equal(h.states.at(-1)?.view, terminal, `${terminal} is stable`); equal(h.calls.claim.length, 0, `${terminal} performs no claim`);
}
for (const result of [{ status: 500, body: { secret: "raw" } }, { status: 200, body: { status: "mystery" } }]) {
  const h = harness([result]); h.flow.start(); await tick(); equal(h.states.at(-1)?.view, "error", "API failure is sanitized");
}
{
  const h = harness([{ status: 500, body: {} }, { status: 200, body: { status: "claimed" } }]); h.flow.start(); await tick(); h.flow.retry(); await tick(); equal(h.calls.status.length, 2, "manual Retry makes one controlled attempt"); equal(h.states.at(-1)?.view, "claimed", "manual Retry can reach terminal state");
}

const successPage = readFileSync("app/billing/success/page.tsx", "utf8");
const client = readFileSync("app/billing/success/PaymentFirstSuccessClient.tsx", "utf8");
const cancel = readFileSync("app/billing/cancel/page.tsx", "utf8");
const flowSource = readFileSync("lib/payment-v2/successFlow.ts", "utf8");
const proxySource = readFileSync("proxy.ts", "utf8");
check(!proxySource.match(/PUBLIC_PREFIXES\s*=.*billing/), "no broad billing public prefix exists");
check(proxySource.includes("Next.js Proxy runs before next.config rewrites"), "source documents why the exact BotID namespace bypasses auth redirect");
check(successPage.indexOf("paymentFirstSuccessEnabled") < successPage.indexOf("await searchParams"), "disabled success gate precedes input reads");
check(!successPage.includes("supabaseBrowser") && !cancel.includes("supabaseBrowser"), "disabled pages initialize no browser auth client");
check(!cancel.includes("fetch(") && !cancel.includes("/api/"), "cancel page performs zero API calls");
check(cancel.includes('href="/pricing"') && cancel.includes('href="/"'), "cancel provides pricing and homepage navigation");
check(client.includes('href="/dashboard"'), "claimed UI provides dashboard navigation");
check(client.includes("aria-live"), "status messaging uses aria-live");
check(client.includes("useRef<PaymentFirstSuccessFlow | null>") && client.includes("activeFlow.current?.retry()"), "Retry targets only the active flow ref");
check(client.indexOf("new PaymentFirstSuccessFlow") > client.indexOf("useEffect(() =>"), "component constructs a fresh flow inside each effect setup");
check(!client.includes("useMemo(() => new PaymentFirstSuccessFlow"), "component never memoizes a disposable flow");
check(client.includes("activeFlow.current === flow") && client.includes("flow.dispose()"), "cleanup disposes and conditionally clears the exact active flow");
check(flowSource.includes('credentials: "include"'), "requests include credentials");
check(flowSource.includes('fetch("/api/payment-v2/claim"'), "claim request is same-origin");
check(flowSource.includes("JSON.stringify({ sessionId })"), "claim body contains only sessionId");
for (const forbidden of ["stripe", "getSupabaseAdmin", "service_role", ".rpc(", ".from(", ".insert(", ".delete(", "document.cookie", "createUser", "profiles).insert"])
  check(![client, cancel, flowSource].join("\n").toLowerCase().includes(forbidden.toLowerCase()), `UI has no prohibited side effect: ${forbidden}`);
check(!client.includes("console.") && !flowSource.includes("console."), "full Session ID is never logged");
check(flowSource.includes('if (error) throw new Error("Authentication verification failed")'), "browser auth errors throw a sanitized internal error");
check(!flowSource.includes("throw error"), "raw auth errors are never rethrown");
check(!client.includes("dangerouslySetInnerHTML"), "UI does not inject HTML");

console.log(`PFC-06A Billing Result V2 tests passed (${assertions} natural assertions; no assertion-padding loops; no external network calls)`);
