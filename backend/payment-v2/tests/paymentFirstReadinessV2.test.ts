import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { protectPaymentV2Checkout, PAYMENT_V2_CHECKOUT_RATE_LIMIT_ID } from "../../../lib/payment-v2/checkoutRequestProtection";
import { calculatePaymentV2Inventory, PAYMENT_V2_PUBLIC_CAPACITY } from "../../../lib/payment-v2/inventory";

let assertions = 0;
const equal = (actual: unknown, expected: unknown) => { assert.equal(actual, expected); assertions += 1; };
const rejects = (fn: () => unknown) => { assert.throws(fn, /inventory_unavailable/); assertions += 1; };
const includes = (value: string, expected: string) => { assert.ok(value.includes(expected), `expected source to include ${expected}`); assertions += 1; };
const excludes = (value: string, prohibited: string) => { assert.ok(!value.includes(prohibited), `expected source to exclude ${prohibited}`); assertions += 1; };
const headers = (values: Record<string,string> = {}) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });
const validHeaders = headers({ origin: "https://www.sirensforge.vip", "content-type": "application/json" });
async function request(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const effects = { credential: 0, database: 0, provider: 0, cookie: 0 };
  const result = await protectPaymentV2Checkout({ checkoutEnabled: "true", protectionEnabled: "true", configuredOrigin: "https://www.sirensforge.vip", production: true, headers: validHeaders, ...(overrides.input as object) }, {
    checkRateLimit: async () => { calls.push("rate"); if (overrides.rateThrow) throw new Error(); return Object.hasOwn(overrides, "rateVerdict") ? overrides.rateVerdict : { rateLimited: Boolean(overrides.rateLimited) }; },
    checkBotId: async () => { calls.push("bot"); if (overrides.botThrow) throw new Error(); return Object.hasOwn(overrides, "botVerdict") ? overrides.botVerdict : { isBot: Boolean(overrides.bot) }; },
    readBody: async () => { calls.push("body"); if (overrides.bodyThrow) throw new Error(); return String(overrides.body ?? '{"tierName":"og_throne"}'); },
    processCheckout: async (body) => {
      calls.push("checkout");
      if (overrides.trackPostProtectionEffects) {
        effects.credential += 1;
        effects.database += 1;
        effects.provider += 1;
        effects.cookie += 1;
      }
      return { status: 201, body: { value: JSON.stringify(body) }, cookie: { name: "test", value: "test", httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 1 } };
    },
  });
  return { result, calls, effects };
}

let run = await request({ input: { checkoutEnabled: undefined } });
equal(run.result.body.code, "PAYMENT_FIRST_CHECKOUT_V2_DISABLED"); equal(run.result.status, 503); equal(run.calls.length, 0);
run = await request({ input: { checkoutEnabled: "TRUE" } }); equal(run.result.body.code, "PAYMENT_FIRST_CHECKOUT_V2_DISABLED"); equal(run.calls.length, 0);
run = await request({ input: { protectionEnabled: undefined } }); equal(run.result.body.code, "PAYMENT_FIRST_CHECKOUT_V2_PROTECTION_DISABLED"); equal(run.calls.length, 0);
run = await request({ input: { protectionEnabled: " true" } }); equal(run.result.body.code, "PAYMENT_FIRST_CHECKOUT_V2_PROTECTION_DISABLED"); equal(run.calls.length, 0);
for (const origin of [undefined, "null", "https://sirensforge.vip", "https://preview.vercel.app", "http://www.sirensforge.vip", "https://www.sirensforge.vip:444", "bad", "https://www.sirensforge.vip, https://evil.test"]) {
  run = await request({ input: { headers: headers({ ...(origin ? { origin } : {}), "content-type": "application/json" }) } }); equal(run.result.body.code, "PAYMENT_V2_ORIGIN_REJECTED"); equal(run.calls.length, 0);
}
for (const configuredOrigin of ["https://www.sirensforge.vip/path", "https://www.sirensforge.vip?q=1", "https://www.sirensforge.vip#x", "https://u:p@www.sirensforge.vip", "http://www.sirensforge.vip"]) {
  run = await request({ input: { configuredOrigin } }); equal(run.result.body.code, "PAYMENT_V2_ORIGIN_REJECTED");
}
for (const contentType of [undefined, "text/plain", "application/x-www-form-urlencoded", "application/json; charset=latin1", "application/json; charset=utf-8; charset=utf-8"]) {
  run = await request({ input: { headers: headers({ origin: "https://www.sirensforge.vip", ...(contentType ? { "content-type": contentType } : {}) }) } }); equal(run.result.body.code, "INVALID_CHECKOUT_REQUEST"); equal(run.calls.length, 0);
}
run = await request({ input: { headers: headers({ origin: "https://www.sirensforge.vip", "content-type": "application/json", "content-length": "1025" }) } }); equal(run.result.body.code, "INVALID_CHECKOUT_REQUEST"); equal(run.calls.length, 0);
run = await request({ rateLimited: true }); equal(run.result.status, 429); equal(run.calls.join(","), "rate");
run = await request({ rateThrow: true }); equal(run.result.body.code, "PAYMENT_V2_REQUEST_VERIFICATION_UNAVAILABLE"); equal(run.calls.join(","), "rate");
for (const rateVerdict of [null, [], {}, { rateLimited: null }, { rateLimited: "false" }]) { run = await request({ rateVerdict }); equal(run.result.body.code, "PAYMENT_V2_REQUEST_VERIFICATION_UNAVAILABLE"); equal(run.calls.join(","), "rate"); }
run = await request({ bot: true }); equal(run.result.status, 403); equal(run.calls.join(","), "rate,bot");
run = await request({ botThrow: true }); equal(run.result.body.code, "PAYMENT_V2_REQUEST_VERIFICATION_UNAVAILABLE"); equal(run.calls.join(","), "rate,bot");
for (const botVerdict of [null, [], {}, { isBot: null }, { isBot: "false" }]) { run = await request({ botVerdict }); equal(run.result.body.code, "PAYMENT_V2_REQUEST_VERIFICATION_UNAVAILABLE"); equal(run.calls.join(","), "rate,bot"); }
run = await request({ body: "{" }); equal(run.result.body.code, "INVALID_CHECKOUT_REQUEST"); equal(run.calls.join(","), "rate,bot,body");
run = await request({ body: "é".repeat(513) }); equal(run.result.body.code, "INVALID_CHECKOUT_REQUEST"); equal(run.calls.join(","), "rate,bot,body");
run = await request({ bodyThrow: true }); equal(run.result.status, 400); equal(run.result.body.code, "INVALID_CHECKOUT_REQUEST"); equal(run.calls.join(","), "rate,bot,body");
run = await request({ input: { headers: headers({ origin: "https://www.sirensforge.vip", "content-type": "application/json; charset=utf-8" }) } }); equal(run.result.status, 201); equal(run.calls.join(","), "rate,bot,body,checkout"); equal(run.result.cookie?.name, "test");
run = await request({ body: '{"tierName":"early_bird","referralCode":" safe_code "}' }); equal(run.result.status, 400); equal(run.result.body.code, "INVALID_CHECKOUT_REQUEST");
equal(PAYMENT_V2_CHECKOUT_RATE_LIMIT_ID, "payment-v2-checkout");

for (const body of [null, [], "og_throne", 1, true, { tierName: "prime_access" }, { tierName: "og_throne", extra: true }, { tierName: "og_throne", referralCode: 7 }]) {
  const semantic = await request({ body: JSON.stringify(body), trackPostProtectionEffects: true });
  equal(semantic.result.status, 400);
  equal(semantic.result.body.code, "INVALID_CHECKOUT_REQUEST");
  equal(semantic.calls.filter((call) => call === "checkout").length, 0);
  equal(semantic.effects.credential, 0);
  equal(semantic.effects.database, 0);
  equal(semantic.effects.provider, 0);
  equal(semantic.effects.cookie, 0);
  equal(semantic.result.cookie, undefined);
}

const now = new Date("2026-08-04T00:00:00.000Z");
let inventory = calculatePaymentV2Inventory([], now); equal(inventory.og_throne.slots_remaining, 50); equal(inventory.early_bird.slots_remaining, 120);
const states = ["SESSION_ASSOCIATED", "PAID_UNCLAIMED", "CLAIMED"];
for (const state of states) { inventory = calculatePaymentV2Inventory([{ tier: "og_throne", state, expires_at: null }], now); equal(inventory.og_throne.slots_remaining, 49); }
inventory = calculatePaymentV2Inventory([{ tier: "og_throne", state: "HELD", expires_at: "2026-08-04T00:00:01Z" }], now); equal(inventory.og_throne.slots_remaining, 49);
for (const expires_at of ["2026-08-03T23:59:59Z", now.toISOString()]) { inventory = calculatePaymentV2Inventory([{ tier: "early_bird", state: "HELD", expires_at }], now); equal(inventory.early_bird.slots_remaining, 120); }
for (const state of ["EXPIRED_UNPAID", "CANCELED_UNPAID", "REFUNDED", "REVOKED"]) { inventory = calculatePaymentV2Inventory([{ tier: "og_throne", state, expires_at: null }], now); equal(inventory.og_throne.slots_remaining, 50); }
equal(calculatePaymentV2Inventory(Array.from({ length: 50 }, () => ({ tier: "og_throne", state: "CLAIMED", expires_at: null })), now).og_throne.slots_remaining, 0);
equal(calculatePaymentV2Inventory(Array.from({ length: 120 }, () => ({ tier: "early_bird", state: "CLAIMED", expires_at: null })), now).early_bird.slots_remaining, 0);
rejects(() => calculatePaymentV2Inventory(Array.from({ length: 51 }, () => ({ tier: "og_throne", state: "CLAIMED", expires_at: null })), now));
rejects(() => calculatePaymentV2Inventory([{ tier: "og_throne", state: "HELD", expires_at: "bad" }], now));
rejects(() => calculatePaymentV2Inventory([{ tier: "bad", state: "CLAIMED", expires_at: null }], now));
rejects(() => calculatePaymentV2Inventory([{ tier: "og_throne", state: "BAD", expires_at: null }], now));
rejects(() => calculatePaymentV2Inventory(null as any, now));
rejects(() => calculatePaymentV2Inventory([], new Date("invalid")));
rejects(() => calculatePaymentV2Inventory([{ tier: "og_throne", state: "HELD", expires_at: null }], now));
rejects(() => calculatePaymentV2Inventory([{ tier: "early_bird", state: "HELD", expires_at: 123 }], now));
inventory = calculatePaymentV2Inventory([
  { tier: "og_throne", state: "HELD", expires_at: "2026-08-04T00:01:00Z" },
  { tier: "early_bird", state: "SESSION_ASSOCIATED", expires_at: null },
  { tier: "early_bird", state: "EXPIRED_UNPAID", expires_at: null },
], now);
equal(inventory.og_throne.slots_remaining, 49);
equal(inventory.early_bird.slots_remaining, 119);
equal(inventory.og_throne.max_slots, 50);
equal(inventory.early_bird.max_slots, 120);
rejects(() => calculatePaymentV2Inventory(Array.from({ length: 121 }, () => ({ tier: "early_bird", state: "PAID_UNCLAIMED", expires_at: null })), now));
equal(PAYMENT_V2_PUBLIC_CAPACITY.og_throne, 50); equal(PAYMENT_V2_PUBLIC_CAPACITY.early_bird, 120);
const migration = readFileSync("supabase/migrations/20260801002800_payment_first_v2_contract.sql", "utf8"); equal(migration.includes("when 'og_throne' then 50 else 120 end"), true);

const homeSource = readFileSync("app/page.tsx", "utf8");
const pricingSource = readFileSync("app/pricing/PricingClient.tsx", "utf8");
const checkoutServiceSource = readFileSync("lib/payment-v2/checkoutService.ts", "utf8");
const protectionSource = readFileSync("lib/payment-v2/checkoutRequestProtection.ts", "utf8");
const checkoutRouteSource = readFileSync("app/api/checkout/subscription-v2/route.ts", "utf8");
const instrumentationSource = readFileSync("instrumentation-client.ts", "utf8");
const nextConfigSource = readFileSync("next.config.mjs", "utf8");
includes(checkoutServiceSource, "export type ValidatedCheckoutRequest");
includes(checkoutServiceSource, "export function parseCheckoutBody");
equal(protectionSource.indexOf("parseCheckoutBody(body)\n") < protectionSource.indexOf("dependencies.processCheckout(request)"), true);
equal(checkoutRouteSource.indexOf("async processCheckout(request)") < checkoutRouteSource.indexOf("createClient(url, key"), true);
equal(checkoutRouteSource.indexOf("async processCheckout(request)") < checkoutRouteSource.indexOf("new Stripe(stripeKey"), true);
equal(checkoutRouteSource.indexOf("async processCheckout(request)") < checkoutRouteSource.indexOf('req.headers.get("cookie")'), true);
includes(instrumentationSource, 'initBotId({ protect: [{ path: "/api/checkout/subscription-v2", method: "POST" }] })');
equal((instrumentationSource.match(/path:/g) ?? []).length, 1);
includes(nextConfigSource, "export default withBotId(nextConfig)");
equal(checkoutRouteSource.indexOf("checkRateLimit:") < checkoutRouteSource.indexOf("async processCheckout(request)"), true);
equal(checkoutRouteSource.indexOf("checkBotId:") < checkoutRouteSource.indexOf("async processCheckout(request)"), true);
includes(homeSource, 'typeof og?.is_active !== "boolean"');
includes(homeSource, 'typeof earlyBird?.is_active !== "boolean"');
includes(homeSource, '"Currently unavailable"');
includes(pricingSource, 'ogUnavailable ? "Currently unavailable"');
includes(pricingSource, 'earlyBirdUnavailable ? "Currently unavailable"');
includes(pricingSource, "ogActive && !ogSoldOut");
includes(pricingSource, "earlyBirdActive && !earlyBirdSoldOut");
includes(pricingSource, "Availability updates as seats are reserved or purchased.");
includes(pricingSource, 'if (!publicPurchase) return;');
excludes(pricingSource, 'if (publicPurchase?.checkoutMode !== "legacy") return;');
includes(pricingSource, 'fetch("/api/subscription/seat-count"');
includes(pricingSource, "setInterval(fetchSeats, 15_000)");
excludes(pricingSource, 'paymentV2 ? <span>Available</span>');
excludes(pricingSource, 'paymentV2 ? "Available"');
includes(pricingSource, '<SeatCounterText tier={seats.og} />');
includes(pricingSource, '<SeatCounterText tier={seats.earlyBird} />');
includes(pricingSource, 'publicPurchase.tiers?.og_throne === "sold_out" || (seats ? seats.og.remaining <= 0 : false)');
includes(pricingSource, 'publicPurchase.tiers?.early_bird === "sold_out" || (seats ? seats.earlyBird.remaining <= 0 : false)');
includes(pricingSource, ') : ogUnavailable ? (');
includes(pricingSource, ') : earlyBirdUnavailable ? (');
includes(pricingSource, '// Do nothing — keep last known good state.');
includes(pricingSource, 'ogTotal !== 50');
includes(pricingSource, 'ebTotal !== 120');
excludes(pricingSource, "Numbers update as soon as a tier is claimed");
excludes(homeSource.toLowerCase(), "prime access");
excludes(pricingSource.toLowerCase(), "prime access");
excludes(homeSource, "/150 LEFT");
excludes(pricingSource, "150 total seats");
includes(pricingSource, 'useState<ViewMode>("compare")');
includes(pricingSource, "Card View");
includes(pricingSource, "Comparison View");
excludes(pricingSource, "Token Boosts & Rewards");
excludes(pricingSource, "Infinite tokens");
excludes(pricingSource, "auto-post empire");
excludes(pricingSource, "before public pricing activates");
includes(pricingSource, 'og: "$1,333 one-time"');
includes(pricingSource, 'earlyBird: "$29.99/month"');
includes(pricingSource, 'og: "50 total seats"');
includes(pricingSource, 'earlyBird: "120 total seats"');
includes(pricingSource, 'label: "Affiliate % (first 6 months)"');
includes(pricingSource, 'label: "Affiliate % (lifetime after 6 months)"');
includes(pricingSource, 'og: "50%"');
includes(pricingSource, 'og: "25%"');
includes(pricingSource, 'earlyBird: "20%"');
includes(pricingSource, 'earlyBird: "10%"');
includes(pricingSource, "10% commission on one-time purchases");
includes(pricingSource, 'label: "Access"');
includes(pricingSource, 'og: "Lifetime founder access — no recurring subscription"');
includes(pricingSource, 'earlyBird: "$29.99/month founder access while subscription remains active"');
includes(pricingSource, '? "/api/checkout/subscription-v2"');

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
equal(packageJson.dependencies["@vercel/firewall"], "1.2.2");
equal(packageJson.dependencies.botid, "1.5.11");
equal(packageLock.packages["node_modules/@vercel/firewall"].version, "1.2.2");
equal(packageLock.packages["node_modules/botid"].version, "1.5.11");
equal(packageLock.packages["node_modules/@vercel/firewall"].resolved, "https://registry.npmjs.org/@vercel/firewall/-/firewall-1.2.2.tgz");
equal(packageLock.packages["node_modules/botid"].resolved, "https://registry.npmjs.org/botid/-/botid-1.5.11.tgz");
console.log(`PFC-07B-1 behavioral contract passed (${assertions} natural assertions; injected fakes and pure calculator, zero external calls).`);
