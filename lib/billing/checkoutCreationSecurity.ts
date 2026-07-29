import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export const PAY_FIRST_HOLD_SECONDS = 60 * 60;
export const RATE_LIMIT_RETENTION_HOURS = 25;
export const TRUSTED_NETWORK_HEADER = "x-vercel-forwarded-for";
const MIN_RATE_LIMIT_SECRET_LENGTH = 32;

export function payFirstCheckoutEnabled(value: unknown): boolean {
  return typeof value === "string" && value.trim() === "true";
}

export function isPublicIp(value: string): boolean {
  const version = isIP(value);
  if (!version) return false;
  if (version === 4) {
    const [a,b] = value.split(".").map(Number);
    return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===192&&b===0)||(a===198&&(b===18||b===19||b===51))||(a===203&&b===0)||(a===100&&b>=64&&b<=127));
  }
  const normalized=value.toLowerCase();
  return normalized!=="::"&&normalized!=="::1"&&!normalized.startsWith("::ffff:")&&!normalized.startsWith("ff")&&!normalized.startsWith("2001:db8")&&!normalized.startsWith("fc")&&!normalized.startsWith("fd")&&!normalized.startsWith("fe8")&&!normalized.startsWith("fe9")&&!normalized.startsWith("fea")&&!normalized.startsWith("feb");
}

export function trustedSourceNetwork(request: Request): string | null {
  const raw=request.headers.get(TRUSTED_NETWORK_HEADER);
  if (!raw || raw.includes(",")) return null;
  const value=raw.trim();
  return value && isPublicIp(value) ? value : null;
}

export function networkRateLimitHash(source: string, secret: string): string {
  if (!isPublicIp(source) || typeof secret!=="string" || secret.length<MIN_RATE_LIMIT_SECRET_LENGTH) throw new Error("rate_limit_configuration");
  return createHmac("sha256",secret).update(source,"utf8").digest("hex");
}

export type CheckoutCreationConfiguration = { priceId:string; baseUrl:string; networkHash:string };
export function checkoutCreationConfiguration(input:{request:Request;rateLimitSecret?:string;supabaseUrl?:string;serviceRoleKey?:string;stripeSecret?:string;priceId?:string;canonicalUrl?:string}):CheckoutCreationConfiguration|null {
  const source=trustedSourceNetwork(input.request);
  if(!source||!input.rateLimitSecret||!input.supabaseUrl||!input.serviceRoleKey||!input.stripeSecret||!input.priceId||!input.canonicalUrl)return null;
  try{
    const canonical=new URL(input.canonicalUrl);
    if(canonical.protocol!=="https:"||canonical.username||canonical.password||canonical.search||canonical.hash)return null;
    return{priceId:input.priceId,baseUrl:canonical.origin+canonical.pathname.replace(/\/$/,""),networkHash:networkRateLimitHash(source,input.rateLimitSecret)};
  }catch{return null}
}
