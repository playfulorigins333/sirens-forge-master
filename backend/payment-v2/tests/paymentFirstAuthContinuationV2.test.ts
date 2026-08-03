import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUTH_ERROR_MESSAGES,
  buildAuthCallbackUrl,
  buildCallbackFailurePath,
  canonicalizePaymentContinuation,
  establishCallbackSession,
  parseCallbackCredentials,
  paymentFirstAuthContinuationEnabled,
  sanitizeAuthError,
  sanitizeLoginMode,
  selectCallbackRedirect,
  selectLoginRedirect,
  trustedApplicationOrigin,
} from "../../../lib/payment-v2/authContinuation";

let assertions = 0;
const equal = (actual: unknown, expected: unknown) => { assert.equal(actual, expected); assertions += 1; };
const match = (actual: string, expected: RegExp) => { assert.match(actual, expected); assertions += 1; };
const absent = (actual: string, expected: RegExp) => { assert.doesNotMatch(actual, expected); assertions += 1; };

const sessionId = "cs_test_PFC06B_123-abc";
const continuation = `/billing/success?session_id=${sessionId}`;

// Exact, server-only feature gate.
equal(paymentFirstAuthContinuationEnabled({ PAYMENT_FIRST_SUCCESS_V2_ENABLED: "true" }), false);
equal(paymentFirstAuthContinuationEnabled({ PAYMENT_FIRST_AUTH_CONTINUATION_V2_ENABLED: "true" }), false);
equal(paymentFirstAuthContinuationEnabled({ PAYMENT_FIRST_AUTH_CONTINUATION_V2_ENABLED: "TRUE", PAYMENT_FIRST_SUCCESS_V2_ENABLED: "true" }), false);
equal(paymentFirstAuthContinuationEnabled({ PAYMENT_FIRST_AUTH_CONTINUATION_V2_ENABLED: " true", PAYMENT_FIRST_SUCCESS_V2_ENABLED: "true" }), false);
equal(paymentFirstAuthContinuationEnabled({ PAYMENT_FIRST_AUTH_CONTINUATION_V2_ENABLED: "true", PAYMENT_FIRST_SUCCESS_V2_ENABLED: "true" }), true);
equal(selectLoginRedirect(null), "/dashboard");
equal(selectCallbackRedirect(null), "/generate");

// The only continuation accepted is reconstructed billing success state.
equal(canonicalizePaymentContinuation(continuation), continuation);
equal(canonicalizePaymentContinuation("/billing/success?session_id=cs_test_a%2Db"), "/billing/success?session_id=cs_test_a-b");
equal(canonicalizePaymentContinuation(`https://evil.example${continuation}`), null);
equal(canonicalizePaymentContinuation(`//evil.example${continuation}`), null);
equal(canonicalizePaymentContinuation("/billing\\success?session_id=cs_test_a"), null);
equal(canonicalizePaymentContinuation("%2F%2Fevil.example"), null);
equal(canonicalizePaymentContinuation("%252Fbilling%252Fsuccess%253Fsession_id%253Dcs_test_a"), null);
equal(canonicalizePaymentContinuation(`${continuation}#fragment`), null);
equal(canonicalizePaymentContinuation("/billing/cancel?session_id=cs_test_a"), null);
equal(canonicalizePaymentContinuation("/billing/success/anything?session_id=cs_test_a"), null);
equal(canonicalizePaymentContinuation("/billing/x/../success?session_id=cs_test_a"), null);
equal(canonicalizePaymentContinuation("/billing/success?session_id=cs_test_a&session_id=cs_test_b"), null);
equal(canonicalizePaymentContinuation("/billing/success?session_id=cs_test_a&extra=1"), null);
equal(canonicalizePaymentContinuation("/billing/success?session_id="), null);
equal(canonicalizePaymentContinuation("/billing/success?session_id=not-a-session"), null);
equal(canonicalizePaymentContinuation(`/billing/success?session_id=cs_${"a".repeat(253)}`), null);
equal(canonicalizePaymentContinuation("javascript:alert(1)"), null);
equal(canonicalizePaymentContinuation("data:text/plain,test"), null);
equal(canonicalizePaymentContinuation("file:///etc/passwd"), null);
equal(canonicalizePaymentContinuation("/billing/success%3Fsession_id=cs_test_a"), null);
equal(canonicalizePaymentContinuation("/billing/success?session_id=cs_test_a%00"), null);
equal(selectLoginRedirect(continuation), continuation);
equal(selectCallbackRedirect(continuation), continuation);

// Login mode and callback errors are finite allowlists.
equal(sanitizeLoginMode("signup"), "signup");
equal(sanitizeLoginMode(undefined), "login");
equal(sanitizeLoginMode("admin"), "login");
equal(sanitizeAuthError("raw failure text"), null);
equal(sanitizeAuthError("oauth_exchange_failed"), "oauth_exchange_failed");
equal(AUTH_ERROR_MESSAGES.oauth_exchange_failed, "We could not complete sign-in. Please try again.");

// Configured application origin is the sole redirect authority.
equal(trustedApplicationOrigin("https://sirens.example", true), "https://sirens.example");
equal(trustedApplicationOrigin("http://sirens.example", true), null);
equal(trustedApplicationOrigin("http://localhost:3000", false), "http://localhost:3000");
equal(trustedApplicationOrigin("https://user:pass@sirens.example", true), null);
equal(trustedApplicationOrigin("https://sirens.example/path", true), null);
equal(trustedApplicationOrigin("https://sirens.example?x=1", true), null);
equal(trustedApplicationOrigin("https://sirens.example#x", true), null);
equal(buildAuthCallbackUrl("https://sirens.example", null), "https://sirens.example/auth/callback");
equal(buildAuthCallbackUrl("https://sirens.example", continuation), `https://sirens.example/auth/callback?next=${encodeURIComponent(continuation)}`);
equal(buildCallbackFailurePath("oauth_failed", null), "/login?error=oauth_failed");
equal(buildCallbackFailurePath("oauth_exchange_failed", continuation), `/login?error=oauth_exchange_failed&next=${encodeURIComponent(continuation)}`);

// Credential parsing rejects ambiguity, duplicates, blanks, and provider failures.
equal(parseCallbackCredentials(new URLSearchParams("code=pkce"))?.kind, "code");
equal(parseCallbackCredentials(new URLSearchParams("code=pkce"))?.code, "pkce");
equal(parseCallbackCredentials(new URLSearchParams("access_token=a&refresh_token=r"))?.kind, "tokens");
equal(parseCallbackCredentials(new URLSearchParams("code=c&access_token=a&refresh_token=r")), null);
equal(parseCallbackCredentials(new URLSearchParams("code=a&code=b")), null);
equal(parseCallbackCredentials(new URLSearchParams("access_token=a&access_token=b&refresh_token=r")), null);
equal(parseCallbackCredentials(new URLSearchParams("access_token=a&refresh_token=r&refresh_token=s")), null);
equal(parseCallbackCredentials(new URLSearchParams("access_token=a")), null);
equal(parseCallbackCredentials(new URLSearchParams("refresh_token=r")), null);
equal(parseCallbackCredentials(new URLSearchParams()), null);
equal(parseCallbackCredentials(new URLSearchParams("code=")), null);
equal(parseCallbackCredentials(new URLSearchParams("error=access_denied&code=c")), null);

async function sessionScenario(credentials: NonNullable<ReturnType<typeof parseCallbackCredentials>>, options: {
  establishError?: boolean; userError?: boolean; user?: unknown;
}) {
  let exchanges = 0; let sessions = 0; let verifications = 0;
  const result = await establishCallbackSession({
    async exchangeCodeForSession() { exchanges += 1; return { error: options.establishError ? {} : null }; },
    async setSession() { sessions += 1; return { error: options.establishError ? {} : null }; },
    async getUser() { verifications += 1; return { data: { user: Object.hasOwn(options, "user") ? options.user! : {} }, error: options.userError ? {} : null }; },
  }, credentials);
  return { result, exchanges, sessions, verifications };
}

const code = parseCallbackCredentials(new URLSearchParams("code=pkce"))!;
const tokens = parseCallbackCredentials(new URLSearchParams("access_token=a&refresh_token=r"))!;
const codeSuccess = await sessionScenario(code, {});
equal(codeSuccess.result, null); equal(codeSuccess.exchanges, 1); equal(codeSuccess.sessions, 0); equal(codeSuccess.verifications, 1);
const tokenSuccess = await sessionScenario(tokens, {});
equal(tokenSuccess.result, null); equal(tokenSuccess.exchanges, 0); equal(tokenSuccess.sessions, 1); equal(tokenSuccess.verifications, 1);
equal((await sessionScenario(code, { establishError: true })).result, "oauth_exchange_failed");
equal((await sessionScenario(tokens, { establishError: true })).result, "oauth_session_failed");
equal((await sessionScenario(code, { userError: true })).result, "oauth_session_failed");
equal((await sessionScenario(code, { user: null })).result, "oauth_session_failed");

// Source contracts cover browser lifecycle and prohibited side effects without mounting or networking.
const client = readFileSync("app/login/LoginClient.tsx", "utf8");
const page = readFileSync("app/login/page.tsx", "utf8");
const callback = readFileSync("app/auth/callback/route.ts", "utf8");
const helper = readFileSync("lib/payment-v2/authContinuation.ts", "utf8");
match(client, /useRef<ReturnType<typeof supabaseBrowser>/);
match(client, /if \(!supabaseRef\.current\) supabaseRef\.current = supabaseBrowser\(\)/);
equal((client.match(/onAuthStateChange\(/g) ?? []).length, 1);
match(client, /subscription\.unsubscribe\(\)/);
match(client, /navigatedRef\.current/);
match(client, /mountedRef\.current = false/);
match(client, /data\.session\?\.user/);
match(client, /setCheckEmail\(true\)/);
match(client, /emailRedirectTo: callbackUrl/);
match(client, /provider: "google" \| "discord"/);
match(page, /paymentFirstAuthContinuationEnabled\(\{/);
match(page, /continuation=\{continuation\}/);
absent(page, /NEXT_PUBLIC_PAYMENT/);
absent(client + callback, /console\./);
absent(client + callback, /claim-status/);
absent(client + callback, /api\/payment-v2\/claim/);
absent(client + callback, /sf_payment_v2_claim/);
absent(client + callback, /profiles?\W/);
absent(client + callback, /entitlements?\W/);
absent(client + callback, /stripe/i);
absent(client + callback, /fetch\(/);
match(helper, /exchangeCodeForSession/);
match(helper, /setSession/);
match(callback, /selectCallbackRedirect/);
absent(callback, /request\.headers|x-forwarded|host\W/i);

console.log(`Payment-first Auth Continuation V2 behavioral contract passed: ${assertions} assertions; zero external network calls.`);
