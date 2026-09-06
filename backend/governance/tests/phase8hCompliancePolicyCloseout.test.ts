import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { MATERIAL_POLICY_MANIFEST as manifest } from "../../../lib/material-policy/manifest"

const terms = readFileSync("app/terms/page.tsx", "utf8")
const privacy = readFileSync("app/privacy/page.tsx", "utf8")
const aup = readFileSync("app/acceptable-use/page.tsx", "utf8")
const closeout = readFileSync("docs/compliance/phase8h-policy-closeout.md", "utf8")

assert.equal(manifest.termsVersion, "terms-2026-09-05-r1")
assert.equal(manifest.privacyVersion, "privacy-2026-09-05-r1")
assert.equal(manifest.acceptableUseVersion, "acceptable-use-2026-08-22-r1")
assert.equal(manifest.materialBundleVersion, "material-policy-2026-09-05-r1")
assert.equal(manifest.acceptanceStatementVersion, "material-policy-acceptance-2026-09-05-r1")
assert.match(terms, /lastUpdated="September 5, 2026"/)
assert.match(privacy, /lastUpdated="September 5, 2026"/)
assert.match(aup, /lastUpdated="August 22, 2026"/)

for (const phrase of [
  "Data Export, Account Deletion, and Legal Holds",
  "valid active legal hold blocks destructive",
  "current material policy bundle",
  "durable policy-acceptance",
]) assert(terms.includes(phrase), `Terms closeout missing: ${phrase}`)

for (const phrase of [
  "30-day Recently Deleted windows",
  "60-day voluntary account-deletion recovery period",
  "60-day post-cancellation retention period",
  "60-day retention period after the second missed recurring subscription payment",
  "Draft working data uses a 90-day retention rule",
  "security and governance audit evidence is retained for 12 months",
  "Governance and Audit Evidence",
  "60-day recovery period",
]) assert(privacy.includes(phrase), `Privacy closeout missing: ${phrase}`)

assert.doesNotMatch(privacy, /current manual contact process/)
assert.doesNotMatch(privacy, /does not represent that automated account deletion/)
assert.doesNotMatch(terms, /does not claim that a general automated material-policy re-consent system currently exists/)

for (const phrase of [
  "DMCA designated agent",
  "not closed by code",
  "37 C.F.R. § 201.38",
  "18 U.S.C. §§ 2257 / 2257A",
  "Do not invent or publish missing agent details",
  "Phase 9 notification delivery",
]) assert(closeout.includes(phrase), `Phase 8H crosswalk missing: ${phrase}`)

assert.match(closeout, /does not:[\s\S]*alter Payment V2 prices or Stripe price IDs/)
assert.match(closeout, /does not:[\s\S]*enable Phase 9 notification delivery/)
assert.match(closeout, /does not:[\s\S]*create a DMCA agent registration/)
assert.match(closeout, /does not:[\s\S]*create or fabricate §2257 records/)

console.log("Phase 8H compliance/policy closeout source contract: PASS")
