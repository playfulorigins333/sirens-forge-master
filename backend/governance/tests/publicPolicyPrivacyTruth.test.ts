import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { isPublicPath } from "../../../proxy"

const read = (path: string) => readFile(path, "utf8")
const [terms, privacy, aup, report, sitemap, account] = await Promise.all([
  read("app/terms/page.tsx"), read("app/privacy/page.tsx"), read("app/acceptable-use/page.tsx"),
  read("app/report-intimate-content/page.tsx"), read("app/sitemap.ts"), read("app/account/page.tsx"),
])
const policies = `${terms}\n${privacy}`
const normalizedPolicies = policies.replace(/\s+/g, " ")
const normalizedTerms = terms.replace(/\s+/g, " ")
const humanAccessCopy = [terms, privacy, aup].flatMap((source) => source.match(/<p>[^<]*(?:Human access|Human\s+access)[\s\S]*?<\/p>/gi) ?? []).join("\n")

assert.doesNotMatch(policies, /outputs are not guaranteed[^.]{0,40}private/i)
assert.doesNotMatch(policies, /we do not verify ownership, consent, or authorization/i)
assert.doesNotMatch(policies, /continued use[^.]{0,80}constitutes acceptance/i)
assert.doesNotMatch(policies, /private creator[^.]{0,120}(?:improve|improvement)[^.]{0,80}(?:service|model)/i)
for (const phrase of ["not used for generalized model training by default", "separate explicit opt-in"]) assert(normalizedPolicies.includes(phrase))
assert.match(normalizedPolicies, /never sells? creator personal data or creator content/i)
assert.match(normalizedPolicies, /private creator content is not used to build advertising or marketing profiles/i)
assert.match(normalizedPolicies, /Human access (?:to private creator content )?is purpose-limited/i)
assert.match(policies, /Automated processing does not imply\s+casual human browsing/i)
assert(humanAccessCopy.length > 0, "human-access paragraphs must remain present")
assert.doesNotMatch(
  humanAccessCopy,
  /Human\s+access[\s\S]{0,500}policy enforcement/i,
  "human private-content access must not use generic policy enforcement as a standalone basis",
)

assert.match(normalizedTerms, /OnlyFans launch workflow[^.]*likeness-bound/i)
assert.match(normalizedTerms, /Fanvue may permit a fully synthetic fictional AI persona/i)
assert.match(normalizedTerms, /General generation may use a fully synthetic fictional persona/i)
assert.match(normalizedTerms, /does not require every persona to resemble the creator/i)

assert.match(aup, /nonconsensual intimate imagery/i)
assert.match(aup, /AI-generated[\s\S]{0,100}deepfakes and face swaps/i)
assert.match(aup, /does not blanket-prohibit[^.]*consensual[^.]*Twin/i)
assert.equal(isPublicPath("/report-intimate-content"), true)
assert.equal(isPublicPath("/report-intimate-content/extra"), false)
assert(sitemap.includes('"/report-intimate-content"'))
assert(report.includes("admin@sirensforge.vip"))
for (const fact of ["name and safe contact information", "depicted or affected person", "stable content URL, asset ID, account reference", "description of the content", "believe the depiction is nonconsensual or unauthorized", "action you request", "good-faith statement", "minimum necessary supporting information"]) assert(report.toLowerCase().includes(fact.toLowerCase()), `missing intake fact: ${fact}`)
for (const warning of ["passwords", "access tokens", "session cookies", "secret keys", "Do not unnecessarily download, copy, forward, or re-upload"]) assert(report.includes(warning), `missing safety warning: ${warning}`)
assert.doesNotMatch(report, /(?:respond|acknowledge|review|resolve|remove|action)[^.!?\n]{0,80}\b(?:within|in)\s+\d+\s+(?:hours?|days?)/i)

const fakeControls = /(?:Delete Account|Reactivate Account|Export My Data|Recently Deleted)/i
assert.doesNotMatch(account, fakeControls)
assert.doesNotMatch(`${terms}\n${privacy}`, /(?:available|provides?|automatically)[^.!?\n]{0,60}(?:Delete Account|Reactivate Account|Export My Data|Recently Deleted)/i)
console.log("public policy/privacy truth regression contract: PASS")
