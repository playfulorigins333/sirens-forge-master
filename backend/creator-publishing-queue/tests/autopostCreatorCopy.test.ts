import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const page = readFileSync("app/autopost/page.tsx", "utf8")
const component = readFileSync("app/autopost/Task14AutopostOrchestration.tsx", "utf8")
const productionCopy = `${page}\n${component}`

test("fallback and publishing-plan copy is creator-safe", () => {
  for (const expected of [
    "Publishing plans",
    "Publishing plans are temporarily unavailable",
    "Existing Autopost tools remain available. Draft Publishing Plans will appear here when your saved package information is available.",
  ]) assert.ok(page.includes(expected), expected)

  for (const expected of [
    "Select existing content packages created in the Package Composer. Sirens Forge will use the saved captions, media, pricing, visibility, disclosures, compliance status, approvals, and destination settings for each package.",
    "Autopost could not confirm whether the draft plan was created. Check your connection, then try again. Sirens Forge will avoid creating a duplicate plan.",
    "Draft Publishing Plan created",
    "Draft Publishing Plan confirmed",
    "Next step: review the selected packages in the Creator Publishing Queue. Nothing was posted or scheduled.",
  ]) assert.ok(component.includes(expected), expected)

  for (const prohibited of [
    "Task 14 Creator Publishing Orchestration",
    "authoritative destination-specific content packages",
    "one idempotency key",
    "trusted server state",
    "trusted server data",
    "same request key will be reused safely",
    "idempotent retry",
    "operator task",
    "job state:",
  ]) assert.equal(productionCopy.includes(prohibited), false, prohibited)

  assert.equal(component.includes("j.jobState"), false)
})

test("publishing-plan safety behavior remains wired", () => {
  assert.match(component, /idempotencyKey:string/)
  assert.match(component, /useState\(idempotencyKey\)/)
  assert.match(component, /body:JSON\.stringify\(\{contentPackageIds:selected,idempotencyKey:key\}\)/)
  assert.match(component, /result\.idempotent\?/)
  assert.match(component, /fetch\("\/api\/creator-publishing-queue\/autopost\/plans"/)
  assert.match(component, /router\.refresh\(\)/)
  assert.match(component, /if\(locked\) return/)
  assert.match(component, /disabled=\{locked\|\|pending\|\|selected\.length===0\}/)
  assert.match(component, /setLocked\(true\)/)
})
