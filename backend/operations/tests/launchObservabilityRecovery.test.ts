import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve(process.cwd(), "docs/operations/launch-observability-alerts-recovery.md");
const doc = readFileSync(path, "utf8");
const roadmap = readFileSync(resolve(process.cwd(), "docs/LAUNCH_ROADMAP_STATUS.md"), "utf8");
let assertions = 0;

function includes(value: string, label: string) {
  assert.ok(doc.includes(value), `${label}: missing ${JSON.stringify(value)}`);
  assertions += 1;
}

function matches(pattern: RegExp, label: string) {
  assert.match(doc, pattern, label);
  assertions += 1;
}

for (const scope of ["playfulorigins333/sirens-forge-master", "playfulorigins333/sirens-forge-api", "Vercel", "Railway", "Supabase"]) includes(scope, "launch-wide scope");
for (const severity of ["P0 — critical", "P1 — major", "P2 — degraded", "P3 — warning"]) includes(severity, "severity model");
for (const mechanism of ["AUTOMATED", "MANUAL OPERATOR CHECK", "CI / DEPLOYMENT GATE", "NOT CONFIGURED"]) includes(mechanism, "alert mechanism taxonomy");

for (const subsystem of [
  "Auth/session failure", "Authorization regression", "Payment V2 configuration readiness",
  "Webhook signature failure", "Claim/entitlement failure", "Affiliate ledger/reconciliation anomaly",
  "CPQ scheduler not running/invocation failure", "CPQ job retry-exhausted", "Fanvue worker/provider finite failure",
  "Generation application execution-disabled", "Railway API deployment/runtime failure", "Dataset Doctor API failure",
  "Public/legal route regression", "Protected Production admin integrity",
]) includes(subsystem, "critical subsystem matrix");

includes("does not mean a human notification platform exists", "automated signal qualification");
includes("No repository evidence establishes a universal automated paging/monitoring platform", "no universal automation claim");
includes("Separate explicit authorization is mandatory", "Production authorization boundary");
includes("LOCKED / FROZEN / GTG", "Payment V2 frozen");
matches(/Fanvue execution remains frozen/i, "Fanvue frozen");
matches(/Pods remain intentionally OFF.*pod-off is not an incident/is, "budget-disabled compute posture");
matches(/mock\/fake output is never proof/i, "no mock generation proof");
includes("Protected Production admin", "protected admin boundary");
includes("Sanitized incident record template", "incident template");
includes("current `main` SHA `2c84f8620dc626a449740b6e946fef1388605cee`", "exact current API audit SHA");
includes("independently audited read-only", "current API source audit complete");
includes("Railway Production reports `SUCCESS` on `main` at that exact SHA", "Railway exact-SHA success evidence");
includes("There is **no custom API health/readiness endpoint**", "no invented API health endpoint");
includes("was **not modified**", "API repository modification explicitly false");
includes("Operators must inspect and redact raw errors and upstream excerpts before copying them into an incident record", "restricted API logging evidence");

for (const secret of [
  "passwords", "Supabase service-role keys", "database passwords", "Stripe secret keys", "webhook secret",
  "payment instrument data", "Fanvue OAuth/access/refresh tokens", "reconnect secret", "`CRON_SECRET`",
  "API internal secret", "cookies/session tokens", "`Authorization` headers", "private encryption keys", "Vault secret values",
]) includes(secret, "redaction category");
includes("`[REDACTED]`", "consistent redaction token");

for (const scenario of [
  "A. Vercel Production deployment fails", "B. Public site returns 5xx", "C. Supabase/auth unavailable",
  "D. Payment webhook/reconciliation anomaly", "E. CPQ scheduler stops invoking", "F. CPQ job retry-exhausted",
  "G. Fanvue finite provider failure", "H. Railway API unavailable", "I. API internal auth not configured",
  "J. Generation request meets intentionally disabled compute", "K. Public/legal route regression",
  "L. Suspected authorization/RLS regression",
]) includes(scenario, "required tabletop");

matches(/Row 48 is \*\*DONE\*\*/i, "row 48 closure");
assert.match(roadmap, /\| 48 \| Operations \| Sanitized observability, alerts and recovery closure \| DONE \|/, "canonical row 48 is DONE"); assertions += 1;

const canonicalStatuses = ["DONE", "LOCKED / FROZEN", "DEFERRED — BUDGET", "DEFERRED — DEPENDENCY", "OPEN", "POST-LAUNCH", "UNKNOWN — VERIFY"] as const;
const canonicalStatusSet = new Set<string>(canonicalStatuses);

function tableSection(source: string, start: string, end: string) {
  const section = source.match(new RegExp(`${start}\\s+([\\s\\S]*?)\\s+${end}`))?.[1];
  assert.ok(section, `roadmap section exists: ${start}`);
  return section;
}

function tableLines(section: string, label: string) {
  const lines = section.split("\n").map(line => line.trim()).filter(Boolean);
  assert.ok(lines.length >= 3, `${label} table has header, separator, and data`);
  assert.ok(lines.every(line => line.startsWith("|") && line.endsWith("|")), `${label} contains only structurally delimited table lines`);
  assert.match(lines[1], /^\|(?:\s*:?-+:?\s*\|)+$/, `${label} separator is valid`);
  return lines.slice(2);
}

function cells(line: string) { return line.slice(1, -1).split("|").map(column => column.trim()); }

function validateRoadmap(source: string) {
  const granularRows = tableLines(tableSection(source, "## Granular launch gates", "## Next zero-spend engineering candidates"), "granular roadmap");
  const actualCounts = new Map<string, number>(canonicalStatuses.map(status => [status, 0]));
  const ids = new Set<number>();
  for (const row of granularRows) {
    const columns = cells(row);
    assert.equal(columns.length, 7, `granular roadmap row has seven columns: ${row}`);
    assert.match(columns[0], /^\d{2}$/, `granular roadmap ID is two-digit numeric: ${row}`);
    const id = Number(columns[0]);
    assert.ok(id > 0 && !ids.has(id), `granular roadmap ID is positive and unique: ${columns[0]}`);
    ids.add(id);
    assert.ok(canonicalStatusSet.has(columns[3]), `granular roadmap status is canonical: ${columns[3]}`);
    actualCounts.set(columns[3], (actualCounts.get(columns[3]) ?? 0) + 1);
  }
  const highestId = Math.max(...ids);
  assert.deepEqual([...ids].sort((a, b) => a - b), Array.from({ length: highestId }, (_, index) => index + 1), "granular roadmap IDs are contiguous from 01");

  const countRows = tableLines(tableSection(source, "## Count by status", "## Non-action safety record"), "status count");
  const reportedCounts = new Map<string, number>();
  let reportedTotal: number | undefined;
  for (const row of countRows) {
    const columns = cells(row).map(value => value.replace(/^\*\*|\*\*$/g, ""));
    assert.equal(columns.length, 2, `status count row has two columns: ${row}`);
    assert.match(columns[1], /^\d+$/, `status count is a non-negative integer: ${row}`);
    if (columns[0] === "Total") {
      assert.equal(reportedTotal, undefined, "status count table has exactly one Total row");
      reportedTotal = Number(columns[1]);
      continue;
    }
    assert.ok(canonicalStatusSet.has(columns[0]), `reported status is canonical: ${columns[0]}`);
    assert.ok(!reportedCounts.has(columns[0]), `reported status is unique: ${columns[0]}`);
    reportedCounts.set(columns[0], Number(columns[1]));
  }
  assert.equal(reportedCounts.size, canonicalStatuses.length, "count table has exactly one row for every canonical status");
  for (const status of canonicalStatuses) assert.equal(reportedCounts.get(status), actualCounts.get(status), `reported ${status} count matches granular rows`);
  assert.notEqual(reportedTotal, undefined, "status count table has one Total row");
  assert.equal(reportedTotal, granularRows.length, "reported total matches granular roadmap row count");
  return { granularRows, actualCounts };
}

const { granularRows, actualCounts } = validateRoadmap(roadmap); assertions += 1;
for (const requiredStatus of ["DEFERRED — BUDGET", "DEFERRED — DEPENDENCY", "POST-LAUNCH", "LOCKED / FROZEN"]) {
  assert.ok((actualCounts.get(requiredStatus) ?? 0) > 0, `required roadmap status remains present: ${requiredStatus}`); assertions += 1;
}

function fixture(statuses: string[], countOverrides: Partial<Record<string, number>> = {}) {
  const rows = statuses.map((status, index) => `| ${String(index + 1).padStart(2, "0")} | Area | Gate ${index + 1} | ${status} | Evidence | Action | None |`).join("\n");
  const counts = canonicalStatuses.map(status => `| ${status} | ${countOverrides[status] ?? statuses.filter(value => value === status).length} |`).join("\n");
  return `## Granular launch gates\n\n| ID | Area | Gate / deliverable | Status | Evidence | Remaining action | Dependency / blocker |\n|---:|---|---|---|---|---|---|\n${rows}\n\n## Next zero-spend engineering candidates\n\nNone.\n\n## Count by status\n\n| Status | Rows |\n|---|---:|\n${counts}\n| **Total** | **${statuses.length}** |\n\n## Non-action safety record\n`;
}

const validOpenFixture = fixture(["DONE", "OPEN"]);
assert.equal(validateRoadmap(validOpenFixture).actualCounts.get("OPEN"), 1, "legitimate OPEN > 0 roadmap validates"); assertions += 1;
const validZeroFixture = fixture(["DONE"]);
assert.equal(validateRoadmap(validZeroFixture).actualCounts.get("OPEN"), 0, "legitimate OPEN = 0 roadmap validates only with its displayed row"); assertions += 1;
const invalidFixtures: Array<[string, string]> = [
  ["missing zero-count OPEN row", validZeroFixture.replace(/^\| OPEN \| 0 \|\n/m, "")],
  ["missing zero-count UNKNOWN row", validZeroFixture.replace(/^\| UNKNOWN — VERIFY \| 0 \|\n/m, "")],
  ["duplicate DONE count row", validOpenFixture.replace("| DONE | 1 |", "| DONE | 1 |\n| DONE | 1 |")],
  ["duplicate Total row", validOpenFixture.replace("| **Total** | **2** |", "| **Total** | **2** |\n| **Total** | **2** |")],
  ["duplicate granular ID", validOpenFixture.replace("| 02 | Area", "| 01 | Area")],
  ["missing granular ID", fixture(["DONE", "OPEN", "DONE"]).replace("| 02 | Area", "| 04 | Area")],
  ["malformed granular row", validOpenFixture.replace("| 02 | Area", "02 | Area")],
  ["wrong granular column count", validOpenFixture.replace("| Evidence | Action | None |", "| Evidence | Action |")],
  ["unknown granular status", validOpenFixture.replace("| OPEN | Evidence", "| SURPRISE | Evidence")],
  ["contradictory displayed count", validOpenFixture.replace("| DONE | 1 |", "| DONE | 0 |")],
  ["wrong Total", validOpenFixture.replace("| **Total** | **2** |", "| **Total** | **3** |")],
];
for (const [label, invalid] of invalidFixtures) { assert.throws(() => validateRoadmap(invalid), undefined, label); assertions += 1; }
for (const preserved of [
  "Stripe | Update Sirens Forge LLC business bank account | DEFERRED — BUDGET",
  "Real-money V2 Checkout/webhook/claim/reconciliation canary | DEFERRED — BUDGET",
  "Stripe Connect | Live account creation/onboarding validation | DEFERRED — BUDGET",
  "Identity-training real-compute proof | DEFERRED — BUDGET",
  "Image-generation real-compute and persistence proof | DEFERRED — BUDGET",
  "OnlyFans | Assisted/manual workflow and final live verification | DEFERRED — DEPENDENCY",
  "X | Launch availability | DEFERRED — DEPENDENCY",
  "Reddit | Launch availability/manual placeholder | DEFERRED — DEPENDENCY",
  "Affiliate | Automated payout execution expansion | POST-LAUNCH",
  "Video generation execution | POST-LAUNCH",
  "Muse Store | POST-LAUNCH",
]) { assert.ok(roadmap.includes(preserved), `preserved roadmap category: ${preserved}`); assertions += 1; }
console.log(`Launch observability/recovery contract passed (${assertions} assertions)`);
