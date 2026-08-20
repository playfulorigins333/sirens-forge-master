import assert from "node:assert/strict"
import { register } from "node:module"

delete process.env.STRIPE_SECRET_KEY
delete process.env.STRIPE_WEBHOOK_SECRET

const emptyServerOnlyModule = "data:text/javascript,export%20{}"
const loaderSource = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') return { url: ${JSON.stringify(emptyServerOnlyModule)}, shortCircuit: true }
  return nextResolve(specifier, context)
}
`
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url)

const { POST } = await import("../../../app/api/webhook/route")
const response = await POST(new Request("https://app.test/api/webhook", {
  method: "POST",
  body: new ReadableStream({
    pull() { throw new Error("missing configuration must fail before reading the webhook body") },
  }),
  duplex: "half",
} as RequestInit))
assert.equal(response.status, 500)
assert.deepEqual(await response.json(), {
  error: "Stripe webhook is not configured",
  code: "STRIPE_WEBHOOK_NOT_CONFIGURED",
})

console.log("Legacy webhook lazy Stripe test passed")

process.env.PAYMENT_FIRST_PUBLIC_CUTOVER_V2_ENABLED = "true"
const legacyCheckout = await import("../../../app/api/checkout/subscription/route")
const checkoutResponse = await legacyCheckout.POST(new Request("https://app.test/api/checkout/subscription", {
  method: "POST",
}))
assert.equal(checkoutResponse.status, 503)
assert.equal((await checkoutResponse.json()).code, "PAYMENT_FIRST_LEGACY_CHECKOUT_CUTOVER")
delete process.env.PAYMENT_FIRST_PUBLIC_CUTOVER_V2_ENABLED

console.log("Legacy checkout import-safe configuration test passed")
