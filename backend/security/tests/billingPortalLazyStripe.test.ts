import assert from "node:assert/strict"
import { register } from "node:module"

delete process.env.STRIPE_SECRET_KEY

const emptyServerOnlyModule = "data:text/javascript,export%20{}"
const loaderSource = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') return { url: ${JSON.stringify(emptyServerOnlyModule)}, shortCircuit: true }
  return nextResolve(specifier, context)
}
`
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url)

const { executeBillingPortal } = await import("../../../app/api/billing/portal/route")
const request = new Request("https://app.test/api/billing/portal", {
  method: "POST",
  headers: { origin: "https://app.test" },
})

let authCalls = 0
let resolverCalls = 0
let providerCalls = 0
const missingConfig = await executeBillingPortal(request, {
  ensureAuthenticatedProfile: async () => { authCalls += 1; throw new Error("must not authenticate") },
  resolveExistingBillingCustomer: async () => { resolverCalls += 1; throw new Error("must not resolve") },
  createPortalSession: async () => { providerCalls += 1; throw new Error("must not call Stripe") },
})
assert.equal(missingConfig.status, 500)
assert.deepEqual(await missingConfig.json(), { error: "Billing portal is not configured", code: "BILLING_PORTAL_NOT_CONFIGURED" })
assert.deepEqual([authCalls, resolverCalls, providerCalls], [0, 0, 0])

const unauthenticated = await executeBillingPortal(request, {
  stripeSecretKey: "test-only-key",
  ensureAuthenticatedProfile: async () => ({ ok: false, error: "UNAUTHENTICATED", status: 401 }),
  resolveExistingBillingCustomer: async () => { resolverCalls += 1; throw new Error("must not resolve") },
  createPortalSession: async () => { providerCalls += 1; throw new Error("must not call Stripe") },
})
assert.equal(unauthenticated.status, 401)
assert.deepEqual(await unauthenticated.json(), { error: "Authentication required", code: "UNAUTHENTICATED" })
assert.deepEqual([resolverCalls, providerCalls], [0, 0])

async function resolvedResponse(resolution: { ok: false; code: "BILLING_CUSTOMER_NOT_FOUND" | "BILLING_CUSTOMER_AMBIGUOUS" }) {
  return executeBillingPortal(request, {
    stripeSecretKey: "test-only-key",
    ensureAuthenticatedProfile: async () => ({ ok: true, profile: { id: "profile-authoritative" } } as never),
    resolveExistingBillingCustomer: async (profileId) => {
      assert.equal(profileId, "profile-authoritative")
      resolverCalls += 1
      return resolution
    },
    createPortalSession: async () => { providerCalls += 1; throw new Error("must not call Stripe") },
  })
}
for (const resolution of [
  { ok: false as const, code: "BILLING_CUSTOMER_NOT_FOUND" as const },
  { ok: false as const, code: "BILLING_CUSTOMER_AMBIGUOUS" as const },
]) {
  const response = await resolvedResponse(resolution)
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, resolution.code)
}
assert.equal(providerCalls, 0)

const created: Array<{ customer: string; return_url: string }> = []
const success = await executeBillingPortal(request, {
  stripeSecretKey: "test-only-key",
  ensureAuthenticatedProfile: async () => ({ ok: true, profile: { id: "profile-authoritative" } } as never),
  resolveExistingBillingCustomer: async () => ({ ok: true, customerId: "cus_authoritative" }),
  createPortalSession: async (args) => {
    created.push(args)
    return { url: "https://billing.stripe.test/session" }
  },
})
assert.equal(success.status, 200)
assert.deepEqual(await success.json(), { url: "https://billing.stripe.test/session" })
assert.deepEqual(created, [{ customer: "cus_authoritative", return_url: "https://app.test/billing" }])

const originalConsoleError = console.error
console.error = () => undefined
try {
  const failed = await executeBillingPortal(request, {
    stripeSecretKey: "test-only-key",
    ensureAuthenticatedProfile: async () => ({ ok: true, profile: { id: "profile-authoritative" } } as never),
    resolveExistingBillingCustomer: async () => ({ ok: true, customerId: "cus_authoritative" }),
    createPortalSession: async () => { throw new Error("raw provider secret detail") },
  })
  assert.equal(failed.status, 500)
  assert.deepEqual(await failed.json(), { error: "Could not open billing portal", code: "BILLING_PORTAL_FAILED" })
} finally {
  console.error = originalConsoleError
}

console.log("Billing Portal lazy Stripe tests passed")
