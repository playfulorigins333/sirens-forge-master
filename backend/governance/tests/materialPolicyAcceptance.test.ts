import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { MATERIAL_POLICY_MANIFEST as manifest, materialPolicyBundleEvidence } from "../../../lib/material-policy/manifest"
import { safeInternalNext } from "../../../lib/material-policy/redirect"
import { validateAcceptanceDeclaration } from "../../../lib/material-policy/service"
import { paymentFirstCheckout, type CheckoutDependencies } from "../../../lib/payment-v2/checkoutService"
import { LOCKED_PAYMENT_V2_PRICES } from "../../../lib/payment-v2/publicPurchaseReadiness"

for (const value of [manifest.termsVersion, manifest.privacyVersion, manifest.acceptableUseVersion, manifest.materialBundleVersion, manifest.acceptanceStatementVersion]) {
  assert.match(value, /2026-08-22-r1$/)
}
for (const [name, path] of [["terms", "app/terms/page.tsx"], ["privacy", "app/privacy/page.tsx"], ["acceptableUse", "app/acceptable-use/page.tsx"]] as const) {
  assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), manifest.sourceSha256[name], `${name} source requires deliberate manifest maintenance`)
}
const canonical = JSON.stringify({ acceptanceStatementVersion: manifest.acceptanceStatementVersion, acceptableUseVersion: manifest.acceptableUseVersion, materialBundleVersion: manifest.materialBundleVersion, privacyVersion: manifest.privacyVersion, sourceRevision: manifest.sourceRevision, sourceSha256: manifest.sourceSha256, termsVersion: manifest.termsVersion })
assert.equal(createHash("sha256").update(canonical).digest("hex"), materialPolicyBundleEvidence())
assert.equal(validateAcceptanceDeclaration(undefined).code, "MATERIAL_POLICY_ACCEPTANCE_REQUIRED")
assert.equal(validateAcceptanceDeclaration({ accepted: false, materialBundleVersion: manifest.materialBundleVersion }).code, "MATERIAL_POLICY_ACCEPTANCE_REQUIRED")
assert.equal(validateAcceptanceDeclaration({ accepted: true, materialBundleVersion: "material-policy-2025-01-01-r1" }).code, "MATERIAL_POLICY_VERSION_MISMATCH")
assert.equal(validateAcceptanceDeclaration({ accepted: true, materialBundleVersion: manifest.materialBundleVersion }).ok, true)
for (const unsafe of ["https://evil.test", "//evil.test", "javascript:alert(1)", "/\\evil.test"]) assert.equal(safeInternalNext(unsafe), "/dashboard")
assert.equal(safeInternalNext("/library?tab=mine"), "/library?tab=mine")

const calls: string[] = []
const deps: CheckoutDependencies = {
  now: () => new Date("2026-08-22T00:00:00Z"), randomCredential: () => Buffer.alloc(32, 1),
  loadTier: async name => [{ name, is_active: true, stripe_price_id: LOCKED_PAYMENT_V2_PRICES[name] }],
  acquireHold: async () => ({ holdId: "10000000-0000-0000-0000-000000000001", state: "HELD", expiresAt: "2026-08-22T01:00:00Z" }),
  recordPolicyAcceptance: async () => { calls.push("receipt"); return "receipt-id" },
  loadAssociatedSessionId: async () => null, associateSession: async () => "associated",
  createSession: async () => { calls.push("stripe"); return { id: "cs_1", url: "https://checkout.test/1" } },
  retrieveSession: async () => { calls.push("retrieve"); throw new Error("unused") },
}
const run = (acceptance: unknown, overrides: Partial<CheckoutDependencies> = {}) => paymentFirstCheckout({ enabled: "true", production: true, configuredOrigin: "https://sirensforge.com", body: { tierName: "og_throne", materialPolicyAcceptance: acceptance } }, { ...deps, ...overrides })
assert.equal((await run(undefined)).status, 428)
assert.equal((await run({ accepted: false, materialBundleVersion: manifest.materialBundleVersion })).status, 428)
assert.equal((await run({ accepted: true, materialBundleVersion: "old" })).body.code, "MATERIAL_POLICY_VERSION_MISMATCH")
assert.equal((await run({ accepted: true, materialBundleVersion: manifest.materialBundleVersion })).status, 200)
assert.deepEqual(calls, ["receipt", "stripe"], "receipt precedes Stripe")
const failed = await run({ accepted: true, materialBundleVersion: manifest.materialBundleVersion }, { recordPolicyAcceptance: async () => { throw new Error("database down") } })
assert.equal(failed.status, 500); assert.equal(calls.filter(x => x === "stripe").length, 1, "persistence failure initiates no further Stripe work")

const pricing = readFileSync("app/pricing/PricingClient.tsx", "utf8")
const consent = readFileSync("app/account/policy-consent/PolicyConsentForm.tsx", "utf8")
for (const source of [pricing, consent]) for (const path of ["/terms", "/privacy", "/acceptable-use"]) assert(source.includes(path))
assert.match(pricing, /useState\(false\)/); assert.match(consent, /useState\(false\)/)
const migration = readFileSync("supabase/migrations/20260822090000_material_policy_acceptance_receipts.sql", "utf8")
assert.match(migration, /before update or delete/); assert.match(migration, /enable row level security/)
assert.match(readFileSync("lib/material-policy/service.ts", "utf8"), /claimed_profile_id/); assert.match(migration, /material_policy_manifest_mismatch/)
assert.doesNotMatch(migration, /\b(?:drop|truncate)\s+(?:table\s+)?public\.(?:payment_v2|profiles|user_subscriptions)/i)
console.log("material policy acceptance regression contract: PASS")
