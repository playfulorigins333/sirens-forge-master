import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
const read = (path: string) => readFileSync(path, "utf8");

test("retention is additive and preserves later-phase boundaries", () => {
  const sql = read("supabase/migrations/20260905031300_phase7_subscription_cancellation_retention.sql");
  assert.match(sql, /subscription_cancellation_retentions/);
  assert.match(sql, /interval '60 days'/);
  assert.match(sql, /interval '30 days'/);
  assert.match(sql, /day_0_notification_due_at/);
  assert.match(sql, /day_55_notification_due_at/);
  assert.match(sql, /service_role/);
  assert.doesNotMatch(sql, /delete\s+from/i);
  assert.doesNotMatch(sql, /delete\s+from\s+auth\.users/i);
  assert.doesNotMatch(sql, /send.*(mail|email)/i);
});

test("creator reads use one retained guard while mutations remain entitled", () => {
  const page = read("app/library/ActiveLibraryPage.tsx");
  const signing = read("app/api/library/assets/[assetId]/signed-url/route.ts");
  const guard = read("lib/creator-read-access.ts");
  assert.match(page, /ensureCreatorReadAccess/);
  assert.match(signing, /ensureCreatorReadAccess/);
  assert.match(signing, /\.eq\("owner_id", auth\.user\.id\)/);
  assert.match(guard, /active\.error !== "NO_ACTIVE_SUBSCRIPTION"/);
  assert.match(guard, /account_lifecycle_state !== "active"/);
  assert.match(guard, /isCancellationSnapshot/);
  assert.match(guard, /status === "canceled"/);
  assert.match(read("lib/subscription-checker.ts"), /canceledButPaidThroughBoundary/);
  for (const path of ["app/api/generate/route.ts", "app/api/video/route.ts", "app/api/lora/train/route.ts"].filter((path) => { try { read(path); return true; } catch { return false; } })) {
    assert.match(read(path), /ensureActiveSubscription/);
    assert.doesNotMatch(read(path), /ensureCreatorReadAccess/);
  }
});

test("read-only UI hides creation and reuse controls and links to account recovery surfaces", () => {
  const ui = read("app/library/LibraryClient.tsx");
  assert.match(ui, /accessMode === "cancellation_retained"/);
  assert.match(ui, /Paid access has ended/);
  assert.match(ui, /Reactivate through Billing/);
  assert.match(ui, /Export your data/);
  assert.match(ui, /if \(readOnly\) return/);
});

test("no public hardship route, automatic purge, or notification delivery was added", () => {
  const routes = readdirSync("app/api", { recursive: true }).map(String);
  assert.equal(routes.some((path) => /hardship|retention-extension/i.test(path)), false);
  const sql = read("supabase/migrations/20260905031300_phase7_subscription_cancellation_retention.sql");
  assert.doesNotMatch(sql, /cron|pg_cron|http_request|net\.http/i);
});
