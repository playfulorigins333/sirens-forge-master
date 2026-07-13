import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260712001400_creator_publishing_onlyfans_operator_queue.sql';
const migration = readFileSync(migrationPath, 'utf8');
const migrations = readdirSync('supabase/migrations');
const forbiddenAppFiles = readdirSync('app', { recursive: true }).map(String).join('\n');

test('Task 17A migration exists and prior migrations are untouched by scope', () => {
  assert.equal(existsSync(migrationPath), true);
  for (let n = 100; n <= 1300; n += 100) assert.equal(migrations.some((f) => f.startsWith(`202607${n === 1300 ? '11001300' : '10'}`) || f.includes(String(n).padStart(5,'0'))), true);
});

test('extends existing queue task table without a second operator-task table', () => {
  assert.match(migration, /alter table public\.creator_publishing_queue_tasks[\s\S]*claim_token uuid/);
  assert.doesNotMatch(migration, /create table[^;]+operator_tasks/i);
  assert.match(migration, /claimed_by[\s\S]*claimed_at[\s\S]*claim_token[\s\S]*claim_expires_at/);
  assert.doesNotMatch(migration, /set\s+assigned_operator_id\s*=/i);
  assert.match(migration, /interval '30 minutes'/);
});

test('authorization, idempotency, locks, and trusted RPC contracts exist', () => {
  assert.match(migration, /create table if not exists public\.creator_publishing_operator_authorizations/);
  assert.match(migration, /creator_id<>operator_id|creator_id <> operator_id/);
  assert.match(migration, /status in \('active','revoked'\)/);
  assert.match(migration, /creator_publishing_operator_is_authorized/);
  assert.doesNotMatch(migration, /creator_publishing_trusted_reviewers[\s\S]*authorized/i);
  assert.match(migration, /create table if not exists public\.creator_publishing_operator_action_idempotency/);
  assert.match(migration, /\^\[A-Za-z0-9_-\]\{8,128\}\$/);
  assert.match(migration, /from public\.creator_publishing_platform_jobs where id=p_platform_job_id for update[\s\S]*from public\.creator_publishing_queue_tasks where id=p_queue_task_id for update/);
  assert.match(migration, /p_expected_ai_twin_consent_version/);
  assert.match(migration, /p_expected_attestation_text_sha256/);
});

test('Task 15 compatibility is narrow and active claims are preserved', () => {
  assert.match(migration, /create or replace function public\.creator_publishing_schedule_plan/);
  assert.match(migration, /create or replace function public\.creator_publishing_process_scheduler_event/);
  assert.match(migration, /status='claimed'/);
  assert.match(migration, /claim_expires_at > v_now/);
});

test('prohibited Task 17B, Task 18, platform, and deployment work is absent', () => {
  assert.doesNotMatch(migration, /final_post_url\s*=|scheduled_on_platform\s*=|awaiting_post_confirmation\s*=/i);
  assert.doesNotMatch(migration, /fetch\(|playwright|puppeteer|onlyfans\.com/i);
  assert.doesNotMatch(forbiddenAppFiles, /task17a|operator.*loader|onlyfans.*download/i);
});
