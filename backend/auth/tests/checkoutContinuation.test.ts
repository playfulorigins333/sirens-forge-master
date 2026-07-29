import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkoutPricingUrl, MAX_REFERRAL_LENGTH, normalizeReferral, parseCheckoutContinuation, serializeCheckoutContinuation } from "../../../lib/auth/checkoutContinuation";
let assertions=0; const check=(v:any,m?:string)=>{assert.ok(v,m);assertions++};
for(const tier of ["og_throne","early_bird"]){const encoded=serializeCheckoutContinuation({tier,referral:" ab 12 "});check(encoded);const intent=parseCheckoutContinuation(encoded);assert.equal(intent?.tier,tier);assertions++;assert.equal(intent?.referral,"AB12");assertions++;assert.equal(intent&&checkoutPricingUrl(intent).startsWith("/pricing?"),true);assertions++;}
for(const tier of ["prime_access","standard","starter_hit","unknown"]) { assert.equal(serializeCheckoutContinuation({tier}),null); assertions++; }
assert.equal(normalizeReferral(" a b-c_1 "),"AB-C_1");assertions++;
assert.equal(normalizeReferral("A".repeat(MAX_REFERRAL_LENGTH)),"A".repeat(MAX_REFERRAL_LENGTH));assertions++;
assert.equal(normalizeReferral("A".repeat(MAX_REFERRAL_LENGTH+1)),null);assertions++;
for(const value of ["tier=og_throne&next=/dashboard","tier=og_throne&next=https://evil.test","tier=og_throne&next=//evil.test","tier=og_throne&next=\\evil","tier=og_throne&next=/pricing%0a","tier=og_throne&next=%2Fpricing","tier=og_throne&next=%E0%A4%A","tier=og_throne&next=/pricing#x","tier=og_throne&next=/pricing&extra=x"]){assert.equal(parseCheckoutContinuation(value),null);assertions++;}
const login=readFileSync("app/login/page.tsx","utf8"), callback=readFileSync("app/auth/callback/route.ts","utf8"), pricing=readFileSync("app/pricing/PricingClient.tsx","utf8");
for(const needle of ["signInWithPassword","data.session","Check your email","provider: \"google\"","provider: \"discord\"","checkoutPricingUrl(intent)"]){check(login.includes(needle),needle)}
check(callback.includes("exchangeCodeForSession"));check(callback.includes("/login?error=oauth_failed"));check(!callback.includes("access_token"));
check(!pricing.includes("useEffect(() => {\n    handleCheckout"));check(pricing.includes("Continue to Stripe"));check(login.includes(': "/dashboard"'));
console.log(`checkoutContinuation: ${assertions} assertions passed`);
