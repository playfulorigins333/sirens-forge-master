import { createHash, randomBytes } from "node:crypto";

export const PAY_FIRST_CHECKOUT_CONTRACT = "sirens_forge_pay_first_v1";
export const PURCHASER_COOKIE = "sf_pay_first_purchaser";
export const PURCHASER_TOKEN_BYTES = 32;
export const PURCHASER_TOKEN_MAX_AGE = 60 * 60 * 24 * 7;

export function generatePurchaserToken(): string {
  return randomBytes(PURCHASER_TOKEN_BYTES).toString("base64url");
}
export function isPurchaserToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
export function hashPurchaserToken(token: string): string {
  if (!isPurchaserToken(token)) throw new Error("invalid_purchaser_token");
  return createHash("sha256").update(token, "utf8").digest("hex");
}
export function readPurchaserCookie(cookieHeader: string | null): string | null {
  const encoded = (cookieHeader || "").split(";").map(v => v.trim()).find(v => v.startsWith(`${PURCHASER_COOKIE}=`))?.slice(PURCHASER_COOKIE.length + 1);
  if (!encoded) return null;
  try { const token = decodeURIComponent(encoded); return isPurchaserToken(token) ? token : null; } catch { return null; }
}
export const purchaserCookieOptions = (deployed: boolean) => ({ httpOnly:true, sameSite:"lax" as const, secure:deployed, path:"/", maxAge:PURCHASER_TOKEN_MAX_AGE });
