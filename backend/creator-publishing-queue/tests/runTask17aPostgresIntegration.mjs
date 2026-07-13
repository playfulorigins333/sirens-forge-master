import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const diagnosticsDir = 'backend/creator-publishing-queue/tests/.task17a-diagnostics';
mkdirSync(diagnosticsDir, { recursive: true });
const psql = process.env.PSQL || 'psql';
const dbUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
function run(label, args, input) {
  const res = spawnSync(psql, args, { input, encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-v ON_ERROR_STOP=1' } });
  if (res.status !== 0) {
    console.error(JSON.stringify({ scenario: label, status: res.status, stdout: res.stdout, stderr: res.stderr }, null, 2));
    process.exit(res.status ?? 1);
  }
  console.log(`[task17a] ${label} ok`);
}
const probe = spawnSync(psql, ['--version'], { encoding: 'utf8' });
if (probe.status !== 0) { console.error('[task17a] psql unavailable; PostgreSQL 15 GitHub workflow is authoritative'); process.exit(127); }
run('bootstrap roles', [dbUrl], "do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role; exception when duplicate_object then null; end $$; create schema if not exists auth; create table if not exists auth.users(id uuid primary key);\n");
for (const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql') && f <= '20260712001400_creator_publishing_onlyfans_operator_queue.sql').sort()) run(`migration ${f}`, [dbUrl, '-f', path.join('supabase/migrations', f)]);
run('task15 regression post-01400', [dbUrl, '-f', 'backend/creator-publishing-queue/tests/task15PostgresIntegration.sql']);
for (const f of ['task17aPostgresIntegration.sql','task17aAuthorizationTimingIntegration.sql','task17aIdempotencyRecoveryIntegration.sql','task17aSafetyGatesIntegration.sql','task17aSchedulerCompatibilityIntegration.sql']) run(f, [dbUrl, '-f', `backend/creator-publishing-queue/tests/${f}`]);
const c = spawnSync(process.execPath, ['backend/creator-publishing-queue/tests/runTask17aConcurrency.mjs'], { stdio: 'inherit', env: process.env });
process.exit(c.status ?? 1);
