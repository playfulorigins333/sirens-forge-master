import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { protectPaymentV2Checkout, PAYMENT_V2_CHECKOUT_RATE_LIMIT_ID } from "../../../lib/payment-v2/checkoutRequestProtection";
import { calculatePaymentV2Inventory, PAYMENT_V2_PUBLIC_CAPACITY } from "../../../lib/payment-v2/inventory";

let assertions = 0;
const equal = (actual: unknown, expected: unknown) => { assert.equal(actual, expected); assertions += 1; };
const rejects = (fn: () => unknown) => { assert.throws(fn, /inventory_unavailable/); assertions += 1; };
const headers = (values: Record<string,string> = {}) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });
const validHeaders = headers({ origin: "https://www.sirensforge.vip", "content-type": "application/json" });
async function request(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const result = await protectPaymentV2Checkout({ checkoutEnabled: "true", protectionEnabled: "true", configuredOrigin: "https://www.sirensforge.vip", production: true, headers: validHeaders, ...(overrides.input as object) }, {
    checkRateLimit: async () => { calls.push("rate"); if (overrides.rateThrow) throw new Error(); return { rateLimited: Boolean(overrides.rateLimited) }; },
    checkBotId: async () => { calls.push("bot"); if (overrides.botThrow) throw new Error(); return { isBot: Boolean(overrides.bot) }; },
    readBody: async () => { calls.push("body"); return String(overrides.body ?? '{"tierName":"og_throne"}'); },
    processCheckout: async (body) => { calls.push("checkout"); return { status: 201, body: { value: JSON.stringify(body) }, cookie: { name: "test", value: "test", httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 1 } }; },
  });
  return { result, calls };
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
for (const contentType of [undefined, "text/plain", "application/x-www-form-urlencoded"]) {
  run = await request({ input: { headers: headers({ origin: "https://www.sirensforge.vip", ...(contentType ? { "content-type": contentType } : {}) }) } }); equal(run.result.body.code, "INVALID_CHECKOUT_REQUEST"); equal(run.calls.length, 0);
}
run = await request({ input: { headers: headers({ origin: "https://www.sirensforge.vip", "content-type": "application/json", "content-length": "1025" }) } }); equal(run.result.body.code, "INVALID_CHECKOUT_REQUEST"); equal(run.calls.length, 0);
run = await request({ rateLimited: true }); equal(run.result.status, 429); equal(run.calls.join(","), "rate");
run = await request({ rateThrow: true }); equal(run.result.body.code, "PAYMENT_V2_REQUEST_VERIFICATION_UNAVAILABLE"); equal(run.calls.join(","), "rate");
run = await request({ bot: true }); equal(run.result.status, 403); equal(run.calls.join(","), "rate,bot");
run = await request({ botThrow: true }); equal(run.result.body.code, "PAYMENT_V2_REQUEST_VERIFICATION_UNAVAILABLE"); equal(run.calls.join(","), "rate,bot");
run = await request({ body: "{" }); equal(run.result.body.code, "INVALID_CHECKOUT_REQUEST"); equal(run.calls.join(","), "rate,bot,body");
run = await request({ body: "é".repeat(513) }); equal(run.result.body.code, "INVALID_CHECKOUT_REQUEST"); equal(run.calls.join(","), "rate,bot,body");
run = await request({ input: { headers: headers({ origin: "https://www.sirensforge.vip", "content-type": "application/json; charset=utf-8" }) } }); equal(run.result.status, 201); equal(run.calls.join(","), "rate,bot,body,checkout"); equal(run.result.cookie?.name, "test");
equal(PAYMENT_V2_CHECKOUT_RATE_LIMIT_ID, "payment-v2-checkout");

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
equal(PAYMENT_V2_PUBLIC_CAPACITY.og_throne, 50); equal(PAYMENT_V2_PUBLIC_CAPACITY.early_bird, 120);
const migration = readFileSync("supabase/migrations/20260801002800_payment_first_v2_contract.sql", "utf8"); equal(migration.includes("when 'og_throne' then 50 else 120 end"), true);
console.log(`PFC-07B-1 behavioral contract passed (${assertions} natural assertions; injected fakes and pure calculator, zero external calls).`);
