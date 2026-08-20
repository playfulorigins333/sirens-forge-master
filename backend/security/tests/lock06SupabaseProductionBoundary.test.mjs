import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const forwardPath = 'supabase/manual/lock06_supabase_production_boundary_forward.sql';
const rollbackPath = 'supabase/manual/lock06_supabase_production_boundary_rollback.sql';
const forward = readFileSync(forwardPath, 'utf8');
const rollback = readFileSync(rollbackPath, 'utf8');
const uncomment = sql => sql.replace(/--.*$/gm, '');

test('forward draft is explicitly non-deployable, narrow, transactional, and guarded', () => {
  assert.match(forward, /SOURCE-ONLY FORWARD HARDENING DRAFT/i);
  assert.match(forward, /Not a Supabase migration/i);
  assert.match(forward, /Do not run against Production/i);
  assert.match(forward, /supabase migration new lock06_supabase_production_boundary/i);
  const sql = uncomment(forward);
  assert.match(sql, /^\s*begin\s*;/i);
  assert.match(sql, /commit\s*;\s*$/i);
  assert.match(sql, /LOCK06_DRIFT/);
  assert.match(sql, /LOCK06_POSTCONDITION_FAILED/);
  for (const target of ['sale_counters', 'muses', 'record_lora_terminal_status']) assert.match(sql, new RegExp(`\\b${target}\\b`, 'i'));
  for (const forbidden of ['payment_v2', 'fanvue', 'stripe', 'autopost_accounts', 'creator_publishing', 'user_subscriptions'])
    assert.doesNotMatch(sql, new RegExp(`\\b${forbidden}\\b`, 'i'));
  assert.doesNotMatch(sql, /^\s*(insert(?:\s+into)?|update|delete(?:\s+from)?|truncate)\b/im);
  assert.doesNotMatch(sql, /\b(drop|create)\s+(table|view|function|trigger)\b/i);
});

test('sale_counters uses invoker semantics and loses browser-role SELECT', () => {
  const sql = uncomment(forward);
  assert.match(sql, /alter\s+view\s+public\.sale_counters\s+set\s*\(\s*security_invoker\s*=\s*true\s*\)/i);
  assert.match(sql, /revoke\s+select\s+on\s+public\.sale_counters\s+from\s+anon\s*,\s*authenticated\s*;/i);
  assert.doesNotMatch(sql, /revoke[^;]*sale_counters[^;]*service_role/i);
});

test('dormant muses browser-role surface is fully contained', () => {
  const sql = uncomment(forward);
  assert.match(sql, /revoke\s+all\s+privileges\s+on\s+table\s+public\.muses\s+from\s+anon\s*,\s*authenticated\s*;/i);
  assert.match(sql, /drop\s+policy\s+"public read muses"\s+on\s+public\.muses\s*;/i);
  assert.doesNotMatch(sql, /revoke[^;]*muses[^;]*service_role/i);
});

test('record_lora_terminal_status receives only a fixed search path', () => {
  const sql = uncomment(forward);
  assert.match(sql, /alter\s+function\s+public\.record_lora_terminal_status\(\)\s+set\s+search_path\s*=\s*pg_catalog\s*,\s*pg_temp\s*;/i);
  assert.doesNotMatch(sql, /create\s+or\s+replace\s+function\s+public\.record_lora_terminal_status/i);
  assert.doesNotMatch(sql, /revoke[^;]*record_lora_terminal_status|grant[^;]*record_lora_terminal_status/i);
});

test('future postgres-owned public objects use explicit grants', () => {
  const sql = uncomment(forward);
  assert.match(sql, /alter\s+default\s+privileges\s+for\s+role\s+postgres\s+in\s+schema\s+public\s+revoke\s+select\s*,\s*insert\s*,\s*update\s*,\s*delete\s+on\s+tables\s+from\s+anon\s*,\s*authenticated\s*,\s*service_role/i);
  assert.match(sql, /alter\s+default\s+privileges\s+for\s+role\s+postgres\s+in\s+schema\s+public\s+revoke\s+execute\s+on\s+functions\s+from\s+anon\s*,\s*authenticated\s*,\s*service_role/i);
  assert.match(sql, /alter\s+default\s+privileges\s+for\s+role\s+postgres\s+in\s+schema\s+public\s+revoke\s+usage\s*,\s*select\s+on\s+sequences\s+from\s+anon\s*,\s*authenticated\s*,\s*service_role/i);
  assert.match(sql, /alter\s+default\s+privileges\s+for\s+role\s+postgres\s+in\s+schema\s+public\s+revoke\s+execute\s+on\s+functions\s+from\s+public/i);
  assert.doesNotMatch(sql, /for\s+role\s+supabase_admin/i);
});

test('rollback is manual-only and restores the audited pre-state', () => {
  const sql = uncomment(rollback);
  for (const text of ['EMERGENCY MANUAL ROLLBACK ONLY', 'fresh backup', 'explicit human approval', 'Never run automatically', 'source-only preparation'])
    assert.match(rollback, new RegExp(text, 'i'));
  assert.match(sql, /LOCK06_ROLLBACK_DRIFT/);
  assert.match(sql, /LOCK06_ROLLBACK_POSTCONDITION_FAILED/);
  assert.match(sql, /alter\s+view\s+public\.sale_counters\s+reset\s*\(\s*security_invoker\s*\)/i);
  assert.match(sql, /grant\s+select\s+on\s+public\.sale_counters\s+to\s+anon\s*,\s*authenticated/i);
  assert.match(sql, /grant\s+all\s+privileges\s+on\s+table\s+public\.muses\s+to\s+anon\s*,\s*authenticated/i);
  assert.match(sql, /create\s+policy\s+"public read muses"\s+on\s+public\.muses\s+for\s+select\s+using\s*\(\s*true\s*\)/i);
  assert.match(sql, /alter\s+function\s+public\.record_lora_terminal_status\(\)\s+reset\s+search_path/i);
  assert.doesNotMatch(sql, /^\s*(insert(?:\s+into)?|update|delete(?:\s+from)?|truncate)\b/im);
});
