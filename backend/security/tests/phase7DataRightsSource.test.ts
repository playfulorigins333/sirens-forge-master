import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("data rights schema preserves Phase 8 and Phase 9 boundaries", () => {
  const migration = read("supabase/migrations/20260905031000_phase7_data_export_account_deletion.sql");
  const hardening = read("supabase/migrations/20260905031100_phase7_export_claim_notification_hardening.sql");
  assert.match(migration, /interval '60 days'/);
  assert.match(migration, /account_deletion_protected_subjects/);
  assert.match(migration, /sole_production_admin_guard/);
  assert.match(migration, /creator_data_exports/);
  assert.match(migration, /ready_notification_due_at/);
  assert.match(hardening, /requested_notification_due_at/);
  assert.match(hardening, /reactivated_notification_due_at/);
  assert.match(hardening, /interval '15 minutes'/);
  assert.doesNotMatch(migration, /delete\s+from\s+auth\.users/i);
});

test("creator data-rights routes remain authenticated but entitlement-independent", () => {
  for (const path of [
    "app/api/account/data-export/route.ts",
    "app/api/account/data-export/[exportId]/download/route.ts",
    "app/api/account/deletion/route.ts",
    "app/api/account/deletion/request/route.ts",
    "app/api/account/deletion/reactivate/route.ts",
  ]) {
    const source = read(path);
    assert.match(source, /ensureAuthenticatedProfile/);
    assert.doesNotMatch(source, /ensureActiveSubscription/);
    assert.match(source, /Cache-Control/);
    assert.match(source, /no-store/);
  }
});

test("normal product access fails closed while voluntary deletion is pending", () => {
  const subscription = read("lib/subscription-checker.ts");
  const legacyIdentity = read("lib/supabaseServer.ts");
  assert.match(subscription, /ACCOUNT_DELETION_PENDING/);
  assert.match(subscription, /account_lifecycle_state !== "active"/);
  assert.match(legacyIdentity, /account_lifecycle_state/);
  assert.match(legacyIdentity, /AccountFrozen/);
});

test("export download authority is server-derived and private", () => {
  const service = read("lib/account-data-rights.ts");
  assert.match(service, /creator-exports\/\$\{authUserId\}\/\$\{exportId\}\.zip/);
  assert.match(service, /signPrivateGenerationObject/);
  assert.match(service, /mark_creator_data_export_downloaded/);
  assert.match(service, /SIRENS_API_INTERNAL_SECRET|sirensApiFetch/);
});

test("Creator Reply export handoff keeps decryption in Vercel and is doubly bound", () => {
  const route = read("app/api/internal/data-export/creator-reply/route.ts");
  const service = read("lib/sirens-mind/creator-reply-export.ts");

  assert.match(route, /x-sirens-api-internal-secret/);
  assert.match(route, /SIRENS_API_INTERNAL_SECRET/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /Object\.keys\(record\)\.sort\(\)/);
  assert.match(route, /export_id/);
  assert.match(route, /auth_user_id/);
  assert.match(route, /Cache-Control/);
  assert.match(route, /no-store/);

  assert.match(service, /creator_data_exports/);
  assert.match(service, /\.eq\("id", exportId\)/);
  assert.match(service, /\.eq\("auth_user_id", authUserId\)/);
  assert.match(service, /exportJob\.status !== "processing"/);
  assert.match(service, /decryptCreatorReplyData/);
  assert.match(service, /assertCreatorReplyKeyVersion/);
  assert.match(service, /parseCreatorReplyCheckpoint/);

  assert.doesNotMatch(route, /notes_ciphertext|checkpoint_ciphertext|DATA_ENCRYPTION_KEY/);
  assert.doesNotMatch(service, /thread_id\s*:/);
});

test("account deletion UI requires strong confirmation and tells the truth about later phases", () => {
  const ui = read("app/account/data-rights/DataRightsClient.tsx");
  assert.match(ui, /DELETE MY ACCOUNT/);
  assert.match(ui, /60-day recovery/);
  assert.match(ui, /Automatic day-60 irreversible purge/);
  assert.match(ui, /later retention\/notification phases/);
  assert.match(ui, /Trained LoRA\/model artifacts/);
});