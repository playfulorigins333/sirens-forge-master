import { parseCheckoutBody, type CheckoutResult, type ValidatedCheckoutRequest } from "./checkoutService";

export const PAYMENT_V2_CHECKOUT_RATE_LIMIT_ID = "payment-v2-checkout";
export const PAYMENT_V2_CHECKOUT_BODY_MAX_BYTES = 1024;

type HeadersLike = { get(name: string): string | null };
type ProtectedResult = CheckoutResult;

export interface CheckoutProtectionDependencies {
  checkRateLimit(): Promise<unknown>;
  checkBotId(): Promise<unknown>;
  readBody(): Promise<string>;
  processCheckout(request: ValidatedCheckoutRequest): Promise<CheckoutResult>;
}

const error = (status: number, message: string, code: string): ProtectedResult => ({
  status,
  body: { error: message, code },
});

function canonicalOrigin(value: string | undefined, production: boolean): string | null {
  if (!value || value.includes(",")) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") ||
        (production && url.protocol !== "https:") || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const parts = value.split(";").map((part) => part.trim());
  if (parts.shift()?.toLowerCase() !== "application/json") return false;
  return parts.length === 0 || (parts.length === 1 && /^charset\s*=\s*utf-8$/i.test(parts[0]));
}

export async function protectPaymentV2Checkout(input: {
  checkoutEnabled?: string;
  protectionEnabled?: string;
  configuredOrigin?: string;
  production: boolean;
  headers: HeadersLike;
}, dependencies: CheckoutProtectionDependencies): Promise<ProtectedResult> {
  if (input.checkoutEnabled !== "true")
    return error(503, "Payment-first Checkout is not active", "PAYMENT_FIRST_CHECKOUT_V2_DISABLED");
  if (input.protectionEnabled !== "true")
    return error(503, "Payment-first Checkout protection is not active", "PAYMENT_FIRST_CHECKOUT_V2_PROTECTION_DISABLED");

  const configuredOrigin = canonicalOrigin(input.configuredOrigin, input.production);
  const requestOrigin = input.headers.get("origin");
  if (!configuredOrigin || requestOrigin !== configuredOrigin)
    return error(403, "Checkout request origin was rejected", "PAYMENT_V2_ORIGIN_REJECTED");
  if (!isJsonContentType(input.headers.get("content-type")))
    return error(400, "Invalid Checkout request", "INVALID_CHECKOUT_REQUEST");

  const declaredLength = input.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > PAYMENT_V2_CHECKOUT_BODY_MAX_BYTES))
    return error(400, "Invalid Checkout request", "INVALID_CHECKOUT_REQUEST");

  try {
    const verdict = await dependencies.checkRateLimit();
    if (!verdict || typeof verdict !== "object" ||
        typeof (verdict as { rateLimited?: unknown }).rateLimited !== "boolean")
      throw new Error("untrusted verdict");
    if ((verdict as { rateLimited: boolean }).rateLimited)
      return error(429, "Too many Checkout requests", "PAYMENT_V2_RATE_LIMITED");
  } catch {
    return error(503, "Checkout request verification is unavailable", "PAYMENT_V2_REQUEST_VERIFICATION_UNAVAILABLE");
  }
  try {
    const verdict = await dependencies.checkBotId();
    if (!verdict || typeof verdict !== "object" ||
        typeof (verdict as { isBot?: unknown }).isBot !== "boolean")
      throw new Error("untrusted verdict");
    if ((verdict as { isBot: boolean }).isBot)
      return error(403, "Automated Checkout requests are not allowed", "PAYMENT_V2_AUTOMATION_REJECTED");
  } catch {
    return error(503, "Checkout request verification is unavailable", "PAYMENT_V2_REQUEST_VERIFICATION_UNAVAILABLE");
  }

  let text: string;
  try { text = await dependencies.readBody(); } catch {
    return error(400, "Invalid Checkout request", "INVALID_CHECKOUT_REQUEST");
  }
  if (new TextEncoder().encode(text).byteLength > PAYMENT_V2_CHECKOUT_BODY_MAX_BYTES)
    return error(400, "Invalid Checkout request", "INVALID_CHECKOUT_REQUEST");
  let body: unknown;
  try { body = JSON.parse(text); } catch {
    return error(400, "Invalid Checkout request", "INVALID_CHECKOUT_REQUEST");
  }
  const request = parseCheckoutBody(body);
  if (!request) return error(400, "Invalid Checkout request", "INVALID_CHECKOUT_REQUEST");
  return dependencies.processCheckout(request);
}
