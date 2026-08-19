import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { isPublicPath } from "../../../proxy";

const runbookPath = "docs/operations/complaints-removal-operations.md";
await access(runbookPath);
const runbook = await readFile(runbookPath, "utf8");
const removal = await readFile("app/content-removal/page.tsx", "utf8");
const complaints = await readFile("app/complaints/page.tsx", "utf8");
const underage = await readFile("app/underage-policy/page.tsx", "utf8");
const sitemap = await readFile("app/sitemap.ts", "utf8");

assert(runbook.includes("admin@sirensforge.vip"), "runbook must preserve the public intake address");
assert(removal.includes("admin@sirensforge.vip"), "removal policy must preserve the public intake address");
assert(complaints.includes("admin@sirensforge.vip"), "complaints policy must preserve the public intake address");

for (const state of [
  "RECEIVED", "TRIAGED", "INFORMATION_NEEDED", "UNDER_REVIEW", "ESCALATED",
  "ACTION_PENDING", "ACTIONED", "NOTIFIED", "APPEAL_OR_COUNTERNOTICE", "CLOSED",
]) assert(runbook.includes(`\`${state}\``), `missing workflow state ${state}`);

for (const priority of ["P0", "P1", "P2", "P3"]) {
  assert(runbook.includes(`**${priority}**`), `missing triage priority ${priority}`);
}
assert(runbook.includes("INTERNAL OPERATIONAL TARGETS"));
assert.match(runbook, /Evidence handling/i);
assert.match(runbook, /Decision and escalation matrix/i);
assert.match(runbook, /Internal notice templates/i);
assert.match(runbook, /Audit record template/i);

for (const scenario of [
  "Unauthorized likeness request",
  "Suspected underage / exploitative-content report",
  "Copyright/DMCA notice",
  "Account/content enforcement appeal",
  "Ordinary complaint with insufficient evidence",
]) assert(runbook.includes(scenario), `missing tabletop scenario: ${scenario}`);

for (const route of ["/complaints", "/content-removal"]) {
  assert.equal(isPublicPath(route), true, `${route} must remain public`);
  assert(sitemap.includes(`"${route}"`), `${route} must remain in the sitemap contract`);
}

const consentPolicyCopy = `${removal}\n${complaints}\n${underage}`;
assert.doesNotMatch(
  consentPolicyCopy,
  /Sirens Forge[^.]{0,120}does not verify[^.]{0,120}consent/i,
  "stale blanket consent-verification disclaimer must not return",
);
assert(removal.includes("applies platform consent, likeness, safety, and policy"));
assert.match(removal, /do not\s+independently\s+establish legal ownership/);
assert.match(removal, /Users remain responsible for obtaining the rights and/);
assert.match(underage, /applies\s+platform age, consent, likeness, safety, and policy/);
assert.match(underage, /do not\s+independently\s+establish legal ownership/);

const publicComplaintRemovalCopy = `${removal}\n${complaints}`;
const hardDeadline = /(?:respond|acknowledge|review|resolve|remove|action)[^.!?\n]{0,80}\b(?:within|in)\s+\d+\s+(?:hours?|business days?|calendar days?|days?)\b/i;
assert.doesNotMatch(publicComplaintRemovalCopy, hardDeadline, "public policy must not promise a hard response deadline");
assert.match(runbook, /not public promises, service-level guarantees, or statutory deadlines/i);

console.log("complaints/removal operations regression contract: PASS");
