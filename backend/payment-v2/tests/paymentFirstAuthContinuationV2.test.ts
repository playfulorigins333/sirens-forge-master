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
import { LoginAuthFlow, type LoginAuthDependencies, type LoginAuthState } from "../../../lib/payment-v2/loginAuthFlow";

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

// Executable login lifecycle contract with local, dependency-injected fakes.
type UserResult = { data: { user: unknown | null }; error: unknown };
type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function harness(options: {
  users?: Array<UserResult | Promise<UserResult>>;
  password?: () => Promise<{ error: unknown }>;
  signup?: (redirect: string | null) => Promise<{ data: { session: { user?: unknown } | null }; error: unknown }>;
  oauth?: (provider: "google" | "discord", redirect: string) => Promise<{ error: unknown }>;
  continuation?: string | null;
} = {}) {
  const states: LoginAuthState[] = [];
  const navigations: string[] = [];
  const oauthCalls: Array<[string, string]> = [];
  const signupRedirects: Array<string | null> = [];
  let getUserCalls = 0; let passwordCalls = 0; let signupCalls = 0; let subscriptionCount = 0; let unsubscribeCount = 0;
  let authEvent: (() => void) | null = null;
  const users = [...(options.users ?? [{ data: { user: null }, error: null }])];
  const dependencies: LoginAuthDependencies = {
    async getUser() {
      getUserCalls += 1;
      const value = users.shift() ?? { data: { user: null }, error: null };
      return await value;
    },
    async passwordLogin() { passwordCalls += 1; return options.password ? options.password() : { error: null }; },
    async signup(_email, _password, redirect) {
      signupCalls += 1; signupRedirects.push(redirect);
      return options.signup ? options.signup(redirect) : { data: { session: null }, error: null };
    },
    async startOAuth(provider, redirect) {
      oauthCalls.push([provider, redirect]);
      return options.oauth ? options.oauth(provider, redirect) : { error: null };
    },
    subscribeAuthState(callback) {
      subscriptionCount += 1; authEvent = callback;
      return () => { unsubscribeCount += 1; authEvent = null; };
    },
    navigate(destination) { navigations.push(destination); },
  };
  const flow = new LoginAuthFlow("login", options.continuation ?? null, "https://sirens.example/auth/callback", null, dependencies);
  flow.subscribe((state) => states.push({ ...state }));
  return {
    flow, states, navigations, oauthCalls, signupRedirects,
    emitAuth: () => authEvent?.(),
    counts: () => ({ getUserCalls, passwordCalls, signupCalls, subscriptionCount, unsubscribeCount }),
  };
}

const raceUser = deferred<UserResult>();
const race = harness({ users: [raceUser.promise, { data: { user: {} }, error: null }] });
race.flow.start(); race.emitAuth();
equal(race.counts().getUserCalls, 1);
equal(race.navigations.length, 0);
raceUser.resolve({ data: { user: null }, error: {} }); await tick();
equal(race.navigations.length, 0);
equal(race.states.at(-1)?.error, "We could not verify your current session. Please try again.");
await race.flow.retryVerification();
equal(race.counts().getUserCalls, 2);
equal(race.navigations.length, 1);
race.emitAuth(); race.emitAuth(); await tick();
equal(race.navigations.length, 1);

const missing = harness(); missing.flow.start(); await tick();
equal(missing.navigations.length, 0);

const paidLogin = harness({ continuation, users: [{ data: { user: null }, error: null }, { data: { user: {} }, error: null }] });
paidLogin.flow.start(); await tick(); await paidLogin.flow.passwordLogin("a", "b");
equal(paidLogin.navigations[0], continuation);
equal(paidLogin.counts().getUserCalls, 2);
const defaultLogin = harness({ users: [{ data: { user: null }, error: null }, { data: { user: {} }, error: null }] });
defaultLogin.flow.start(); await tick(); await defaultLogin.flow.passwordLogin("a", "b");
equal(defaultLogin.navigations[0], "/dashboard");
const loginVerifyError = harness({ users: [{ data: { user: null }, error: null }, { data: { user: null }, error: {} }] });
loginVerifyError.flow.start(); await tick(); await loginVerifyError.flow.passwordLogin("a", "b");
equal(loginVerifyError.navigations.length, 0);
equal(loginVerifyError.states.at(-1)?.error, "We could not verify your current session. Please try again.");
const returnedLoginError = harness({ password: async () => ({ error: {} }) });
returnedLoginError.flow.start(); await tick(); await returnedLoginError.flow.passwordLogin("a", "b");
equal(returnedLoginError.counts().getUserCalls, 1);
equal(returnedLoginError.navigations.length, 0);
const thrownLogin = harness({ password: async () => { throw new Error("secret"); } });
thrownLogin.flow.start(); await tick(); await thrownLogin.flow.passwordLogin("a", "b");
equal(thrownLogin.states.at(-1)?.error, "Email or password was not accepted. Please try again.");

const immediateSignup = harness({ continuation, users: [{ data: { user: null }, error: null }, { data: { user: {} }, error: null }], signup: async () => ({ data: { session: { user: {} } }, error: null }) });
immediateSignup.flow.start(); await tick(); await immediateSignup.flow.signup("a", "b");
equal(immediateSignup.navigations[0], continuation);
const immediateSignupError = harness({ users: [{ data: { user: null }, error: null }, { data: { user: null }, error: {} }], signup: async () => ({ data: { session: { user: {} } }, error: null }) });
immediateSignupError.flow.start(); await tick(); await immediateSignupError.flow.signup("a", "b");
equal(immediateSignupError.navigations.length, 0);
equal(immediateSignupError.states.at(-1)?.error, "We could not verify your current session. Please try again.");
const emailSignup = harness({ continuation }); emailSignup.flow.start(); await tick();
await emailSignup.flow.signup("a", "b"); await emailSignup.flow.signup("a", "b");
equal(emailSignup.states.at(-1)?.checkEmail, true);
equal(emailSignup.navigations.length, 0);
equal(emailSignup.counts().signupCalls, 1);
equal(emailSignup.signupRedirects[0], "https://sirens.example/auth/callback");
emailSignup.flow.returnToSignIn();
equal(emailSignup.states.at(-1)?.checkEmail, false);
equal(emailSignup.states.at(-1)?.mode, "login");
await emailSignup.flow.passwordLogin("a", "b");
equal(emailSignup.counts().passwordCalls, 1);
equal(emailSignup.counts().signupCalls, 1);

const oauthReturned = harness({ oauth: async () => ({ error: {} }) }); oauthReturned.flow.start(); await tick();
await oauthReturned.flow.startOAuth("google");
equal(oauthReturned.states.at(-1)?.error, "We could not start sign-in. Please try again.");
equal(oauthReturned.states.at(-1)?.oauthBusy, false);
equal(oauthReturned.navigations.length, 0);
equal(oauthReturned.oauthCalls[0]?.[1], "https://sirens.example/auth/callback");
const oauthThrown = harness({ oauth: async () => { throw new Error("provider secret"); } }); oauthThrown.flow.start(); await tick();
await oauthThrown.flow.startOAuth("discord");
equal(oauthThrown.states.at(-1)?.error, "We could not start sign-in. Please try again.");
equal(oauthThrown.states.at(-1)?.oauthBusy, false);
equal(oauthThrown.oauthCalls[0]?.[0], "discord");
const oauthPending = deferred<{ error: unknown }>();
const duplicateOauth = harness({ oauth: () => oauthPending.promise }); duplicateOauth.flow.start(); await tick();
const firstOauth = duplicateOauth.flow.startOAuth("google"); const secondOauth = duplicateOauth.flow.startOAuth("discord");
equal(duplicateOauth.oauthCalls.length, 1); oauthPending.resolve({ error: {} }); await Promise.all([firstOauth, secondOauth]);
equal(duplicateOauth.states.at(-1)?.oauthBusy, false);
const lateOauth = deferred<{ error: unknown }>();
const disposedOauth = harness({ oauth: () => lateOauth.promise }); disposedOauth.flow.start(); await tick();
const stateCountBeforeOauth = disposedOauth.states.length; const oauthCompletion = disposedOauth.flow.startOAuth("google");
disposedOauth.flow.dispose(); lateOauth.resolve({ error: {} }); await oauthCompletion;
equal(disposedOauth.states.length, stateCountBeforeOauth + 1);

const lateVerify = deferred<UserResult>(); const disposedVerify = harness({ users: [lateVerify.promise] });
disposedVerify.flow.start(); disposedVerify.flow.dispose(); lateVerify.resolve({ data: { user: {} }, error: null }); await tick();
equal(disposedVerify.navigations.length, 0);
equal(disposedVerify.counts().unsubscribeCount, 1);
equal(disposedVerify.counts().subscriptionCount, 1);
const latePasswordResult = deferred<{ error: unknown }>();
const disposedPassword = harness({ password: () => latePasswordResult.promise }); disposedPassword.flow.start(); await tick();
const passwordCompletion = disposedPassword.flow.passwordLogin("a", "b"); disposedPassword.flow.dispose();
latePasswordResult.resolve({ error: null }); await passwordCompletion;
equal(disposedPassword.navigations.length, 0);
const lateSignupResult = deferred<{ data: { session: { user?: unknown } | null }; error: unknown }>();
const disposedSignup = harness({ signup: () => lateSignupResult.promise }); disposedSignup.flow.start(); await tick();
const signupCompletion = disposedSignup.flow.signup("a", "b"); disposedSignup.flow.dispose();
lateSignupResult.resolve({ data: { session: { user: {} } }, error: null }); await signupCompletion;
equal(disposedSignup.navigations.length, 0);
const competingUser = deferred<UserResult>(); const competing = harness({ users: [competingUser.promise] });
competing.flow.start(); competing.emitAuth(); competing.emitAuth(); competingUser.resolve({ data: { user: {} }, error: null }); await tick();
equal(competing.counts().getUserCalls, 1);
equal(competing.navigations.length, 1);
const movingDestination = deferred<UserResult>(); const destinationFlow = harness({ continuation, users: [movingDestination.promise] });
destinationFlow.flow.start(); destinationFlow.flow.updateServerValues(null, "https://sirens.example/auth/callback");
movingDestination.resolve({ data: { user: {} }, error: null }); await tick();
equal(destinationFlow.navigations[0], "/dashboard");
const changedDestination = deferred<UserResult>(); const changedFlow = harness({ continuation, users: [changedDestination.promise] });
changedFlow.flow.start(); const newer = "/billing/success?session_id=cs_test_new";
changedFlow.flow.updateServerValues(newer, "https://sirens.example/auth/callback?next=new"); changedDestination.resolve({ data: { user: {} }, error: null }); await tick();
equal(changedFlow.navigations[0], newer);

// Callback service behavior executes injected auth dependencies without importing the route.
const rejectedCodeAuth = {
  async exchangeCodeForSession() { throw new Error("secret"); }, async setSession() { return { error: null }; },
  async getUser() { return { data: { user: {} }, error: null }; },
};
equal(await establishCallbackSession(rejectedCodeAuth, code), "oauth_exchange_failed");
const rejectedTokensAuth = {
  async exchangeCodeForSession() { return { error: null }; }, async setSession() { throw new Error("secret"); },
  async getUser() { return { data: { user: {} }, error: null }; },
};
equal(await establishCallbackSession(rejectedTokensAuth, tokens), "oauth_session_failed");
const rejectedUserAuth = {
  async exchangeCodeForSession() { return { error: null }; }, async setSession() { return { error: null }; },
  async getUser(): Promise<{ data: { user: unknown }; error: unknown }> { throw new Error("secret"); },
};
equal(await establishCallbackSession(rejectedUserAuth, code), "oauth_session_failed");

// Source assertions are limited to prohibited side effects and raw-next isolation.
const client = readFileSync("app/login/LoginClient.tsx", "utf8");
const callback = readFileSync("app/auth/callback/route.ts", "utf8");
const flowSource = readFileSync("lib/payment-v2/loginAuthFlow.ts", "utf8");
absent(client, /searchParams|useSearchParams|[?&]next=/);
absent(client + callback + flowSource, /console\./);
absent(client + callback + flowSource, /claim-status/);
absent(client + callback + flowSource, /api\/payment-v2\/claim/);
absent(client + callback + flowSource, /sf_payment_v2_claim/);
absent(client + callback + flowSource, /fetch\(/);
absent(callback, /request\.headers|x-forwarded|host\W/i);

console.log(`Payment-first Auth Continuation V2 behavioral contract passed: ${assertions} natural assertions; executable fake dependencies; zero external network calls.`);
