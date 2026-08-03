import { validateSuccessSearchParams } from "./successFlow";

export type LoginMode = "login" | "signup";
export type AuthErrorCode =
  | "oauth_missing_credentials"
  | "oauth_exchange_failed"
  | "oauth_session_failed"
  | "oauth_failed";

export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  oauth_missing_credentials: "The sign-in response was incomplete. Please try again.",
  oauth_exchange_failed: "We could not complete sign-in. Please try again.",
  oauth_session_failed: "We could not verify your sign-in session. Please try again.",
  oauth_failed: "Sign-in was cancelled or could not be completed. Please try again.",
};

export function paymentFirstAuthContinuationEnabled(env: {
  PAYMENT_FIRST_AUTH_CONTINUATION_V2_ENABLED?: string;
  PAYMENT_FIRST_SUCCESS_V2_ENABLED?: string;
}): boolean {
  return env.PAYMENT_FIRST_AUTH_CONTINUATION_V2_ENABLED === "true" &&
    env.PAYMENT_FIRST_SUCCESS_V2_ENABLED === "true";
}

export function canonicalizePaymentContinuation(candidate: unknown): string | null {
  if (typeof candidate !== "string" || !candidate.startsWith("/") || candidate.startsWith("//")) return null;
  if (candidate.includes("\\") || /[\u0000-\u001f\u007f]/.test(candidate) || candidate.includes("#")) return null;
  const rawPath = candidate.split("?", 1)[0];
  if (rawPath.includes("%") || rawPath.split("/").some((segment) => segment === "." || segment === "..")) return null;
  let parsed: URL;
  try { parsed = new URL(candidate, "https://payment-continuation.invalid"); } catch { return null; }
  if (parsed.origin !== "https://payment-continuation.invalid" || parsed.pathname !== "/billing/success") return null;
  if (parsed.username || parsed.password || [...parsed.searchParams.keys()].some((key) => key !== "session_id")) return null;
  const sessionIds = parsed.searchParams.getAll("session_id");
  if (sessionIds.length !== 1) return null;
  const sessionId = validateSuccessSearchParams({ session_id: sessionIds[0] });
  return sessionId ? `/billing/success?session_id=${encodeURIComponent(sessionId)}` : null;
}

export function sanitizeLoginMode(value: unknown): LoginMode {
  return value === "signup" ? "signup" : "login";
}

export function sanitizeAuthError(value: unknown): AuthErrorCode | null {
  return typeof value === "string" && Object.hasOwn(AUTH_ERROR_MESSAGES, value)
    ? value as AuthErrorCode : null;
}

export function singleQueryValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

export function selectLoginRedirect(continuation: string | null): string {
  return continuation ?? "/dashboard";
}

export function selectCallbackRedirect(continuation: string | null): string {
  return continuation ?? "/generate";
}

export function trustedApplicationOrigin(value: string | undefined, production: boolean): string | null {
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
  if (production && url.protocol !== "https:") return null;
  if (!production && url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) return null;
  return url.origin;
}

export function buildAuthCallbackUrl(origin: string, continuation: string | null): string {
  const url = new URL("/auth/callback", origin);
  if (continuation) url.searchParams.set("next", continuation);
  return url.toString();
}

export function buildCallbackFailurePath(code: AuthErrorCode, continuation: string | null): string {
  const params = new URLSearchParams({ error: code });
  if (continuation) params.set("next", continuation);
  return `/login?${params.toString()}`;
}

export type CallbackCredentials = { kind: "code"; code: string } |
  { kind: "tokens"; accessToken: string; refreshToken: string };

export function parseCallbackCredentials(params: URLSearchParams): CallbackCredentials | null {
  if (["error", "error_code", "error_description"].some((key) => params.has(key))) return null;
  const codes = params.getAll("code");
  const access = params.getAll("access_token");
  const refresh = params.getAll("refresh_token");
  if ([codes, access, refresh].some((values) => values.length > 1 || values.some((value) => value.length === 0))) return null;
  if (codes.length === 1 && access.length === 0 && refresh.length === 0) return { kind: "code", code: codes[0] };
  if (codes.length === 0 && access.length === 1 && refresh.length === 1) {
    return { kind: "tokens", accessToken: access[0], refreshToken: refresh[0] };
  }
  return null;
}

export interface CallbackAuth {
  exchangeCodeForSession(code: string): Promise<{ error: unknown }>;
  setSession(tokens: { access_token: string; refresh_token: string }): Promise<{ error: unknown }>;
  getUser(): Promise<{ data: { user: unknown | null }; error: unknown }>;
}

export async function establishCallbackSession(auth: CallbackAuth, credentials: CallbackCredentials): Promise<AuthErrorCode | null> {
  let result: { error: unknown };
  try {
    result = credentials.kind === "code"
      ? await auth.exchangeCodeForSession(credentials.code)
      : await auth.setSession({ access_token: credentials.accessToken, refresh_token: credentials.refreshToken });
  } catch {
    return credentials.kind === "code" ? "oauth_exchange_failed" : "oauth_session_failed";
  }
  if (result.error) return credentials.kind === "code" ? "oauth_exchange_failed" : "oauth_session_failed";
  let verification: Awaited<ReturnType<CallbackAuth["getUser"]>>;
  try { verification = await auth.getUser(); } catch { return "oauth_session_failed"; }
  return verification.error || !verification.data.user ? "oauth_session_failed" : null;
}
