import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const databaseUrl = process.env.TASK20_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('TASK20_DATABASE_URL or DATABASE_URL is required');
const parsedDatabaseUrl = new URL(databaseUrl);
if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(parsedDatabaseUrl.hostname) || parsedDatabaseUrl.port !== '5432' || parsedDatabaseUrl.pathname !== '/task20_ci' || parsedDatabaseUrl.search || parsedDatabaseUrl.hash) {
  throw new Error('Task 20 concurrency tests require local PostgreSQL database task20_ci on port 5432');
}
const logPath = 'task20-concurrency-diagnostics.log';
writeFileSync(logPath, `Task 20 audited-wrapper concurrency diagnostics\nstarted_at=${new Date().toISOString()}\n`);

const actor = '00000000-0000-4000-8000-000000000202';
const digest = '1111111111111111111111111111111111111111111111111111111111111111';
const wrongToken = '99999999-0000-4000-8000-000000000999';
function uuid(family, seed) { return `${family}-0000-4000-8000-${String(seed).padStart(12, '0')}`; }
function quote(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function printTail() { try { console.error(readFileSync(logPath, 'utf8').split(/\n/).slice(-220).join('\n')); } catch {} }
function sqlFile(label, sql) {
  const file = join(mkdtempSync(join(tmpdir(), 'task20-concurrency-')), `${label.replace(/[^A-Za-z0-9_-]/g, '_')}.sql`);
  writeFileSync(file, `\\set ON_ERROR_STOP on\nset lock_timeout='10s';\nset statement_timeout='30s';\n${sql}\n`);
  return file;
}
function runSql(label, sql) {
  const file = sqlFile(label, sql);
  const res = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', file], { encoding: 'utf8' });
  appendFileSync(logPath, `\n## ${label}\n${res.stdout || ''}${res.stderr || ''}${res.error ? `spawn_error=${res.error.message}\n` : ''}`);
  if (res.status !== 0) throw new Error(`${label} failed with status ${res.status}`);
  return res.stdout || '';
}
function scalar(label, sql) {
  const res = spawnSync('psql', [databaseUrl, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  appendFileSync(logPath, `\n## scalar ${label}\nexit=${res.status}\nstdout:\n${res.stdout || ''}\nstderr:\n${res.stderr || ''}`);
  if (res.status !== 0) throw new Error(`${label} scalar failed with status ${res.status}`);
  const values = (res.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (values.length !== 1) throw new Error(`${label} scalar expected one value, got ${values.length}`);
  return values[0];
}
async function runSide(label, sql) {
  const file = sqlFile(label, sql);
  return await new Promise((resolve) => {
    const proc = spawn('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', file]);
    let stdout = '', stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += String(chunk); });
    proc.stderr.on('data', (chunk) => { stderr += String(chunk); });
    proc.on('error', (error) => resolve({ status: null, stdout, stderr: `${stderr}${error}` }));
    proc.on('exit', (status) => resolve({ status, stdout, stderr }));
  });
}
function fixture(seed) { return { seed, job: uuid('40000000', seed), task: uuid('50000000', seed), token: uuid('60000000', seed), evidence: uuid('70000000', seed) }; }
function auditedCall(f, key, { url = 'https://www.onlyfans.com/12345/trusteduser', token = f.token } = {}) {
  return `select public.creator_publishing_complete_onlyfans_manual_post_audited('complete','${actor}'::uuid,'${f.job}'::uuid,${quote(key)},'${f.evidence}'::uuid,${quote(url)},null,'${digest}',8,'image/jpeg','${token}'::uuid) as result;`;
}
async function race(label, leftSql, rightSql) {
  const barrierAt = scalar(`barrier-${label}`, `select (clock_timestamp() + interval '2 seconds')::text;`);
  if (Number.isNaN(Date.parse(barrierAt))) throw new Error(`${label} invalid barrier timestamp ${barrierAt}`);
  const wait = `select pg_sleep(greatest(0,extract(epoch from ('${barrierAt}'::timestamptz-clock_timestamp()))));`;
  const [left, right] = await Promise.all([runSide(`left-${label}`, `${wait}\n${leftSql}`), runSide(`right-${label}`, `${wait}\n${rightSql}`)]);
  appendFileSync(logPath, `\n## race ${label} left\nexit=${left.status}\n${left.stdout}${left.stderr}\n## race ${label} right\nexit=${right.status}\n${right.stdout}${right.stderr}\n`);
  if (left.status !== 0 || right.status !== 0) throw new Error(`${label} concurrent calls did not both complete successfully`);
}

try {
  runSql('verify-task20-support', `do $$ begin if to_regprocedure('public.creator_publishing_complete_onlyfans_manual_post_audited(text,uuid,uuid,text,uuid,text,text,text,integer,text,uuid)') is null then raise exception 'TASK20_WRAPPER_MISSING'; end if; if to_regprocedure('task20_test.create_fixture(integer,uuid,boolean)') is null then raise exception 'TASK20_TEST_SUPPORT_MISSING'; end if; end $$;`);
  const success = fixture(100);
  runSql('seed-success-race', `select task20_test.create_fixture(${success.seed});`);
  await race('identical-success', auditedCall(success, 'task20-race-success-0100'), auditedCall(success, 'task20-race-success-0100'));
  runSql('assert-success-race', `do $$ begin if (select count(*) from public.creator_publishing_audit_events where entity_id='${success.job}'::uuid and action='operator_onlyfans_manual_completion_proof_recorded' and idempotency_key='task20-race-success-0100') <> 1 then raise exception 'TASK20_SUCCESS_RACE_PROOF_COUNT'; end if; if (select count(*) from public.creator_publishing_operator_action_idempotency where actor_id='${actor}'::uuid and action_type='manual_completion' and idempotency_key='task20-race-success-0100') <> 1 then raise exception 'TASK20_SUCCESS_RACE_IDEMPOTENCY_COUNT'; end if; if exists(select 1 from public.creator_publishing_audit_events where entity_id='${success.job}'::uuid and action='operator_onlyfans_manual_completion_rejected' and idempotency_key='task20-race-success-0100') then raise exception 'TASK20_SUCCESS_RACE_UNEXPECTED_REJECTION'; end if; end $$;`);
  runSql('success-sequential-replay', `${auditedCall(success, 'task20-race-success-0100')} do $$ begin if (select count(*) from public.creator_publishing_audit_events where entity_id='${success.job}'::uuid and action='operator_onlyfans_manual_completion_proof_recorded' and idempotency_key='task20-race-success-0100') <> 1 then raise exception 'TASK20_SUCCESS_REPLAY_DUPLICATE_PROOF'; end if; end $$;`);

  const rejected = fixture(101);
  runSql('seed-rejection-race', `select task20_test.create_fixture(${rejected.seed});`);
  await race('identical-rejection', auditedCall(rejected, 'task20-race-reject-0101', { token: wrongToken }), auditedCall(rejected, 'task20-race-reject-0101', { token: wrongToken }));
  runSql('assert-rejection-race', `do $$ begin if (select count(*) from public.creator_publishing_audit_events where entity_id='${rejected.job}'::uuid and action='operator_onlyfans_manual_completion_rejected' and idempotency_key='task20-race-reject-0101') <> 1 then raise exception 'TASK20_REJECTION_RACE_EVENT_COUNT'; end if; if (select count(*) from public.creator_publishing_operator_action_idempotency where actor_id='${actor}'::uuid and action_type='manual_completion_rejection' and idempotency_key='task20-race-reject-0101') <> 1 then raise exception 'TASK20_REJECTION_RACE_IDEMPOTENCY_COUNT'; end if; if (select after_state->>'rejection_code' from public.creator_publishing_audit_events where entity_id='${rejected.job}'::uuid and action='operator_onlyfans_manual_completion_rejected' and idempotency_key='task20-race-reject-0101') <> 'current_claim_required' then raise exception 'TASK20_REJECTION_RACE_WRONG_CODE'; end if; if exists(select 1 from public.creator_publishing_audit_events where entity_id='${rejected.job}'::uuid and action='operator_onlyfans_manual_completion_proof_recorded' and idempotency_key='task20-race-reject-0101') then raise exception 'TASK20_REJECTION_RACE_UNEXPECTED_PROOF'; end if; end $$;`);
  runSql('rejection-sequential-replay', `${auditedCall(rejected, 'task20-race-reject-0101', { token: wrongToken })} do $$ begin if (select count(*) from public.creator_publishing_audit_events where entity_id='${rejected.job}'::uuid and action='operator_onlyfans_manual_completion_rejected' and idempotency_key='task20-race-reject-0101') <> 1 then raise exception 'TASK20_REJECTION_REPLAY_DUPLICATE_EVENT'; end if; end $$;`);
  runSql('rejection-material-conflict', `do $$ declare r jsonb; begin r := public.creator_publishing_complete_onlyfans_manual_post_audited('complete','${actor}'::uuid,'${rejected.job}'::uuid,'task20-race-reject-0101','${rejected.evidence}'::uuid,'https://www.onlyfans.com/54321/trusteduser',null,'${digest}',8,'image/jpeg','${wrongToken}'::uuid); if r->>'code' <> 'idempotency_conflict' or coalesce((r->>'replayed')::boolean,false) then raise exception 'TASK20_REJECTION_DIFFERENT_REQUEST_NOT_CONFLICT'; end if; if (select stored_result->>'code' from public.creator_publishing_operator_action_idempotency where actor_id='${actor}'::uuid and action_type='manual_completion_rejection' and idempotency_key='task20-race-reject-0101') <> 'current_claim_required' then raise exception 'TASK20_REJECTION_CONFLICT_REUSED_UNRELATED_RESULT'; end if; if (select count(*) from public.creator_publishing_audit_events where entity_id='${rejected.job}'::uuid and action='operator_onlyfans_manual_completion_rejected' and idempotency_key='task20-race-reject-0101') <> 1 then raise exception 'TASK20_REJECTION_CONFLICT_DUPLICATE_EVENT'; end if; end $$;`);
  appendFileSync(logPath, `\nTASK20_CONCURRENCY_PASSED\ncompleted_at=${new Date().toISOString()}\n`);
  console.log('TASK20_CONCURRENCY_PASSED');
} catch (error) {
  appendFileSync(logPath, `\nFAILED: ${error?.stack || error}\ncompleted_at=${new Date().toISOString()}\n`);
  printTail();
  process.exit(1);
}
