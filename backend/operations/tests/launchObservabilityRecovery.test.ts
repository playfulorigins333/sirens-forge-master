import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve(process.cwd(), "docs/operations/launch-observability-alerts-recovery.md");
const doc = readFileSync(path, "utf8");
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
includes("current SHA, `app/main.py`", "truthful API audit blocker");
includes("does **not** claim that the API has a health/readiness endpoint", "no invented API health endpoint");

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

matches(/Row 48 must remain \*\*OPEN\*\*/i, "honest unresolved cross-repository audit blocker");
console.log(`Launch observability/recovery contract passed (${assertions} assertions)`);
