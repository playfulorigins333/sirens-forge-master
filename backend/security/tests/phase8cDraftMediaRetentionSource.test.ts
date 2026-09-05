import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260905080000_phase8_draft_media_library_retention.sql", "utf8");
const runner = readFileSync("lib/retention/phase8c.ts", "utf8");
const route = readFileSync("app/api/internal/retention/phase8c/run/route.ts", "utf8");
const vercel = readFileSync("vercel.json", "utf8");

test("planner drafts use the locked 90-day inactivity policy", () => {
  assert.match(migration, /planner_draft_inactivity[^\n]+interval '90 days'/i);
  assert.match(migration, /draft_retention_expires_at/);
  assert.match(migration, /phase8c_touch_draft_from_media/);
  assert.match(migration, /phase8c_touch_draft_from_target/);
  assert.match(migration, /new\.status <> 'draft'/);
});

test("draft purge is automatic, audited, bounded, and legal-hold aware", () => {
  assert.match(migration, /phase8c_purge_expired_planner_drafts/);
  assert.match(migration, /governance_target_has_active_legal_hold\('content_post'/);
  assert.match(migration, /append_governance_audit_event/);
  assert.match(migration, /retention\.planner_draft_purged/);
  assert.match(migration, /p_limit > 500/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.content_posts\s+where\s+status\s*<>\s*'draft'/i);
});

test("active library media is preserved and Trash stays 30 days", () => {
  assert.match(migration, /private_generation_asset_trash/);
  assert.match(migration, /current_retention_policy\('private_generation_asset_trash'/);
  assert.doesNotMatch(migration, /update public\.generation_assets[\s\S]{0,200}lifecycle_state='trashed'[\s\S]{0,200}where[^;]*lifecycle_state='active'/i);
  assert.match(migration, /a\.lifecycle_state='trashed'/);
  assert.match(migration, /a\.purge_after<=statement_timestamp\(\)/);
});

test("governance holds block private media purge", () => {
  assert.match(migration, /private_generation_asset/);
  assert.match(migration, /governance_target_has_active_legal_hold\('generation'/);
  assert.match(migration, /phase8c_private_media_purge_hold_guard/);
  assert.match(runner, /PRIVATE_MEDIA_LEGAL_HOLD/);
});

test("retention execution is authenticated and does not add Phase 9 notifications", () => {
  assert.match(route, /authenticateSchedulerRequest/);
  assert.match(route, /CRON_SECRET/);
  assert.match(runner, /retention_expired/);
  assert.doesNotMatch(migration + runner + route, /send_email|send_notification|deliver_notification/i);
  assert.match(vercel, /\/api\/internal\/retention\/phase8c\/run/);
});

test("Twin draft statuses are outside Phase 8C draft purge scope", () => {
  assert.doesNotMatch(migration, /delete\s+from\s+public\.user_loras/i);
  assert.doesNotMatch(runner, /user_loras/);
});
