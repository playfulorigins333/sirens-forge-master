export const CHECKOUT_TIERS=["og_throne","early_bird"] as const;
export type CheckoutTier=(typeof CHECKOUT_TIERS)[number];
export const CHECKOUT_DESTINATION="/checkout/complete" as const;
export const MAX_REFERRAL_LENGTH=32;
export type CheckoutContinuation={reservation:string;sessionId:string;next:typeof CHECKOUT_DESTINATION};
export type AuthenticationMode="login"|"signup";
export function initialAuthenticationMode(value:unknown):AuthenticationMode{return value==="signup"?"signup":"login"}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION=/^cs_[A-Za-z0-9_]{8,120}$/;
export function parseCheckoutTier(v:unknown):CheckoutTier|null{return typeof v==="string"&&CHECKOUT_TIERS.includes(v as CheckoutTier)?v as CheckoutTier:null}
export function normalizeReferral(v:unknown):string|null{if(v==null||v==="")return null;if(typeof v!=="string"||/[\x00-\x1f\x7f]/.test(v))return null;const n=v.trim().toUpperCase().replace(/\s+/g,"");return n.length>0&&n.length<=MAX_REFERRAL_LENGTH&&/^[A-Z0-9_-]+$/.test(n)?n:null}
export function parseCheckoutContinuation(v:unknown):CheckoutContinuation|null{
 if(typeof v!=="string"||!v||v.length>300||/[\\#\x00-\x1f\x7f]/.test(v))return null;let p:URLSearchParams;try{p=new URLSearchParams(v)}catch{return null}
 const keys=[...p.keys()];if(keys.some((k,i)=>!["reservation","session_id","next"].includes(k)||keys.indexOf(k)!==i))return null;
 const reservation=p.get("reservation")||"",sessionId=p.get("session_id")||"";if(!UUID.test(reservation)||!SESSION.test(sessionId)||p.get("next")!==CHECKOUT_DESTINATION)return null;
 return{reservation,sessionId,next:CHECKOUT_DESTINATION};
}
export function serializeCheckoutContinuation(input:{reservation:unknown;sessionId:unknown}):string|null{if(typeof input.reservation!=="string"||!UUID.test(input.reservation)||typeof input.sessionId!=="string"||!SESSION.test(input.sessionId))return null;return new URLSearchParams({reservation:input.reservation,session_id:input.sessionId,next:CHECKOUT_DESTINATION}).toString()}
export function checkoutPricingUrl(i:CheckoutContinuation):string{return `${CHECKOUT_DESTINATION}?${new URLSearchParams({session_id:i.sessionId,reservation:i.reservation})}`}
export function authenticationDestination(i:CheckoutContinuation|null,fallback="/dashboard"):string{return i?checkoutPricingUrl(i):fallback}
export function checkoutAuthCallbackUrl(origin:string,serialized:string|null):string{const u=new URL("/auth/callback",origin),i=parseCheckoutContinuation(serialized);if(i)u.searchParams.set("checkout_intent",serializeCheckoutContinuation(i)!);return u.toString()}
export function signupAuthOptions(origin:string,serialized:string|null){const i=parseCheckoutContinuation(serialized);return i?{emailRedirectTo:checkoutAuthCallbackUrl(origin,serializeCheckoutContinuation(i))}:undefined}
export function signupDestination(hasSession:boolean,i:CheckoutContinuation|null):string|null{return hasSession?authenticationDestination(i):null}
export function oauthCallbackDestination(serialized:string|null,succeeded:boolean):string{if(!succeeded)return"/login?error=oauth_failed";return authenticationDestination(parseCheckoutContinuation(serialized),"/generate")}
