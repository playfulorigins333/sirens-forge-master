import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const databaseUrl = process.env.TASK18_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('TASK18_DATABASE_URL or DATABASE_URL is required');

const logPath = 'task18-concurrency-diagnostics.log';
writeFileSync(logPath, `Task 18 concurrency diagnostics\nstarted_at=${new Date().toISOString()}\n`);

const actor = '00000000-0000-4000-8000-000000000202';
const creator = '00000000-0000-4000-8000-000000000101';
const reviewer = '00000000-0000-4000-8000-000000000303';
const account = '00000000-0000-4000-8000-000000000401';
const digest = '1111111111111111111111111111111111111111111111111111111111111111';

function printTail() {
  try { console.error(readFileSync(logPath, 'utf8').split(/\n/).slice(-160).join('\n')); } catch {}
}
function sqlQuote(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function uuid(seed, family = '10000000') { return `${family}-0000-4000-8000-${String(seed).padStart(12, '0')}`; }
function sqlFile(label, sql) {
  const file = join(mkdtempSync(join(tmpdir(), 'task18-conc-')), `${label.replace(/[^A-Za-z0-9_-]/g, '_')}.sql`);
  writeFileSync(file, `\\set ON_ERROR_STOP on\nset lock_timeout='2s';\nset statement_timeout='20s';\n${sql}\n`);
  return file;
}
function psql(label, sql, args = []) {
  const file = sqlFile(label, sql);
  const res = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', ...args, '-f', file], { encoding: 'utf8' });
  appendFileSync(logPath, `\n## ${label}\n${res.stdout || ''}${res.stderr || ''}${res.error ? `spawn_error=${res.error.message}\n` : ''}`);
  if (res.status !== 0) {
    console.error(res.stdout || '');
    console.error(res.stderr || '');
    throw new Error(`${label} failed with status ${res.status}`);
  }
  return res.stdout || '';
}
function scalar(label, sql) {
  const res = spawnSync('psql', [databaseUrl, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  appendFileSync(logPath, `\n## scalar ${label}\nexit=${res.status}\nstdout:\n${res.stdout || ''}\nstderr:\n${res.stderr || ''}${res.error ? `spawn_error=${res.error.message}\n` : ''}`);
  if (res.status !== 0) throw new Error(`${label} scalar failed with status ${res.status}`);
  const values = (res.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (values.length !== 1) throw new Error(`${label} scalar expected one value, got ${values.length}: ${JSON.stringify(values)}`);
  const value = values[0];
  if (/\n|\r/.test(value) || /\bSET\b/i.test(value) || Number.isNaN(Date.parse(value))) throw new Error(`${label} scalar returned invalid timestamp: ${JSON.stringify(value)}`);
  return value;
}

function fixtureSql(index, { evidenceStatus = 'verified', schedulerStatus = 'processing' } = {}) {
  const pkg = uuid(2000 + index);
  const plan = uuid(3000 + index);
  const job = uuid(4000 + index);
  const task = uuid(5000 + index);
  const token = uuid(6000 + index);
  const evidence = uuid(7000 + index);
  const scheduler = uuid(8000 + index);
  const requestKey = `race${String(index).padStart(4, '0')}`;
  const requestFingerprint = String(index).padStart(64, 'a').slice(-64).replace(/[^a-f0-9]/g, 'a');
  const storagePath = `operator-completion-evidence/race/${index}/proof.jpg`;
  return { pkg, plan, job, task, token, evidence, scheduler, requestKey, storagePath, sql: `
    insert into auth.users(id,email) values
      ('${creator}'::uuid,'task18-race-creator@test'),('${actor}'::uuid,'task18-race-operator@test'),('${reviewer}'::uuid,'task18-race-reviewer@test') on conflict do nothing;
    insert into public.creator_publishing_creator_verifications(creator_id,status,evidence_reference,reason,reviewed_by,reviewed_at)
      values ('${creator}'::uuid,'verified','race-evidence','ok','${reviewer}'::uuid,now())
      on conflict (creator_id) do update set status='verified', reviewed_at=now();
    insert into public.creator_publishing_ai_twin_consents(creator_id,status,attestation_version,attestation_text_sha256,granted_at)
      values ('${creator}'::uuid,'granted','v1','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',now())
      on conflict (creator_id) do update set status='granted', revoked_at=null;
    insert into public.creator_publishing_operator_authorizations(creator_id,operator_id,platform,status)
      values ('${creator}'::uuid,'${actor}'::uuid,'onlyfans','active')
      on conflict (creator_id, operator_id, platform) where status='active'
      do update set status='active', revoked_at=null, updated_at=now();
    insert into public.creator_platform_accounts(id,creator_id,platform,platform_username,verification_status,verification_attested_at,verification_reviewed_by,verification_reviewed_at,verification_evidence_reference,verification_reason)
      values ('${account}'::uuid,'${creator}'::uuid,'onlyfans','trusteduser','verified',now(),'${reviewer}'::uuid,now(),'race-evidence','ok')
      on conflict (id) do update set verification_status='verified';
    insert into public.creator_publishing_content_packages(id,creator_id,platform_account_id,target_platform,title,caption_body,compliance_status,creator_approval_status,creator_approved_at,creator_approved_by,compliance_policy_version)
      values ('${pkg}'::uuid,'${creator}'::uuid,'${account}'::uuid,'onlyfans','race package ${index}','caption','passed','approved',now(),'${creator}'::uuid,'task18-test-policy-v1');
    insert into public.creator_publishing_plans(id,creator_id,status,idempotency_key,request_fingerprint,registry_version)
      values ('${plan}'::uuid,'${creator}'::uuid,'in_progress','plan-race-${index}','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','task18');
    insert into public.creator_publishing_platform_jobs(id,publishing_plan_id,creator_id,content_package_id,platform_account_id,target_platform,publishing_mode,job_state,source_package_updated_at,source_package_fingerprint,capability_registry_version,original_request_fingerprint)
      values ('${job}'::uuid,'${plan}'::uuid,'${creator}'::uuid,'${pkg}'::uuid,'${account}'::uuid,'onlyfans','assisted','due_now',(select updated_at from public.creator_publishing_content_packages where id='${pkg}'::uuid),'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','task18','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd');
    update public.creator_publishing_platform_jobs set source_package_fingerprint=public.creator_publishing_autopost_source_fingerprint(content_package_id) where id='${job}'::uuid;
    insert into public.creator_publishing_compliance_reviews(content_package_id,reviewer_id,outcome,review_source,compliance_policy_version,rule_hits,review_metadata,created_at)
      values ('${pkg}'::uuid,'${reviewer}'::uuid,'pass','automated','task18-test-policy-v1','[]'::jsonb,'{}'::jsonb,clock_timestamp());
    insert into public.creator_publishing_queue_tasks(id,content_package_id,creator_id,target_platform,platform_account_id,status,due_at,claimed_by,claimed_at,claim_token,claim_expires_at,operator_progress_state)
      values ('${task}'::uuid,'${pkg}'::uuid,'${creator}'::uuid,'onlyfans','${account}'::uuid,'claimed',now(),'${actor}'::uuid,now(),'${token}'::uuid,now()+interval '20 minutes','handoff_ready');
    insert into public.creator_publishing_scheduler_events(id,creator_id,publishing_plan_id,platform_job_id,event_type,status,due_at,schedule_revision,lock_token,locked_at)
      values ('${scheduler}'::uuid,'${creator}'::uuid,'${plan}'::uuid,'${job}'::uuid,'publish_due','${schedulerStatus}',now(),1,case when '${schedulerStatus}'='processing' then gen_random_uuid() else null end,case when '${schedulerStatus}'='processing' then now() else null end);
    insert into public.creator_publishing_operator_completion_evidence_intents(id,actor_id,creator_id,queue_task_id,platform_job_id,content_package_id,platform_account_id,request_key,request_fingerprint,claim_fingerprint,operation,server_bucket,server_path,expected_mime_type,expected_size_bytes,normalized_mime_type,actual_size_bytes,verified_sha256,status,intent_expires_at,verified_at,created_at,updated_at)
      values ('${evidence}'::uuid,'${actor}'::uuid,'${creator}'::uuid,'${task}'::uuid,'${job}'::uuid,'${pkg}'::uuid,'${account}'::uuid,'${requestKey}','${requestFingerprint}',public.task18_claim_fingerprint('${task}'::uuid,'${token}'::uuid),'create','operator-completion-evidence','${storagePath}','image/jpeg',8,${evidenceStatus === 'verified' ? `'image/jpeg',8,'${digest}','verified',now()+interval '15 minutes',now()` : `null,null,null,'pending',now()+interval '15 minutes',null`},now(),now());
  ` };
}

function completeSql(f, key, { url = 'https://www.onlyfans.com/12345/trusteduser', token = f.token } = {}) {
  return `select public.creator_publishing_complete_onlyfans_manual_post('complete','${actor}'::uuid,'${f.job}'::uuid,'${key}','${f.evidence}'::uuid,${url === null ? 'null' : sqlQuote(url)},null,'${digest}',8,'image/jpeg','${token}'::uuid) as result;`;
}
function replayProbeSql(f, key, url = 'https://www.onlyfans.com/12345/trusteduser') {
  return `select public.creator_publishing_complete_onlyfans_manual_post('replay_probe','${actor}'::uuid,'${f.job}'::uuid,'${key}','${f.evidence}'::uuid,${sqlQuote(url)},null,null,null,null,null) as result;`;
}
function opSql(kind, f) {
  switch (kind) {
    case 'release': return `select public.creator_publishing_release_onlyfans_operator_task('${actor}'::uuid,'${f.task}'::uuid,'${f.job}'::uuid,'${f.token}'::uuid,'release-${f.requestKey}');`;
    case 'reassign': return `update public.creator_publishing_queue_tasks set claimed_by='${reviewer}'::uuid, claim_token=gen_random_uuid() where id='${f.task}'::uuid and status='claimed';`;
    case 'expire': return `update public.creator_publishing_queue_tasks set claimed_at=clock_timestamp()-interval '21 minutes', claim_expires_at=clock_timestamp()-interval '1 minute' where id='${f.task}'::uuid and status='claimed';`;
    case 'revoke': return `update public.creator_publishing_operator_authorizations set status='revoked', revoked_at=greatest(clock_timestamp(), authorized_at), updated_at=clock_timestamp() where creator_id='${creator}'::uuid and operator_id='${actor}'::uuid and platform='onlyfans' and status='active';`;
    case 'cancel': return `select public.creator_publishing_cancel_job_schedule('${creator}'::uuid,'${f.job}'::uuid,'Task 18 race cancellation','cancel-${f.requestKey}');`;
    case 'source': return `update public.creator_publishing_content_packages set title=title || ' changed' where id='${f.pkg}'::uuid;`;
    case 'scheduler': return `select public.creator_publishing_process_scheduler_event('${f.scheduler}'::uuid,(select lock_token from public.creator_publishing_scheduler_events where id='${f.scheduler}'::uuid),'v1','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');`;
    case 'replace': return `select public.creator_publishing_reserve_completion_evidence_intent('${actor}'::uuid,'${f.job}'::uuid,'replace','replace${f.requestKey}','image/jpeg',8,'${f.evidence}'::uuid,'operator-completion-evidence','operator-completion-evidence/race/replace-${f.requestKey}',now()+interval '1 minute',now());`;
    case 'verify': return `select public.creator_publishing_verify_completion_evidence_intent('${actor}'::uuid,'${f.job}'::uuid,'${f.evidence}'::uuid,'image/jpeg',8,'${digest}');`;
    default: throw new Error(`unknown operation ${kind}`);
  }
}

function classify(result) {
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status === 0) return { ok: true, code: 0, text };
  if (/deadlock detected|lock timeout|statement timeout/i.test(text)) return { ok: false, fatal: true, code: result.status, text };
  return { ok: false, code: result.status, text };
}
async function runSide(file) {
  return await new Promise((resolve) => {
    const proc = spawn('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', file], { encoding: 'utf8' });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (d) => { stdout += String(d); });
    proc.stderr.on('data', (d) => { stderr += String(d); });
    proc.on('exit', (status) => resolve({ status, stdout, stderr }));
    proc.on('error', (error) => resolve({ status: null, stdout, stderr: String(error) }));
  });
}
async function race(label, f, leftSql, rightSql, assertSql, allowed) {
  const barrierAt = scalar(`barrier-${label}`, `select (clock_timestamp() + interval '2 seconds')::text;`);
  if (barrierAt.includes('\n') || /\bSET\b/i.test(barrierAt) || Number.isNaN(Date.parse(barrierAt))) throw new Error(`${label} invalid barrier timestamp ${JSON.stringify(barrierAt)}`);
  psql(`ready-left-${label}`, `insert into task18_concurrency.events(label,side,detail,barrier_at) values (${sqlQuote(label)},'left','barrier-ready','${barrierAt}'::timestamptz);`);
  psql(`ready-right-${label}`, `insert into task18_concurrency.events(label,side,detail,barrier_at) values (${sqlQuote(label)},'right','barrier-ready','${barrierAt}'::timestamptz);`);
  const sleep = `select pg_sleep(greatest(0, extract(epoch from ('${barrierAt}'::timestamptz - clock_timestamp()))));`;
  const leftFile = sqlFile(`left-${label}`, `${sleep}\nbegin;\n${leftSql}\ncommit;`);
  const rightFile = sqlFile(`right-${label}`, `${sleep}\nbegin;\n${rightSql}\ncommit;`);
  const [left, right] = await Promise.all([runSide(leftFile), runSide(rightFile)]);
  const l = classify(left), r = classify(right);
  appendFileSync(logPath, `\n## race ${label}\nbarrier_at=${barrierAt}\nleft_exit=${left.status}\nleft_output:\n${left.stdout}${left.stderr}\nright_exit=${right.status}\nright_output:\n${right.stdout}${right.stderr}\n`);
  if (l.fatal || r.fatal) throw new Error(`${label} deadlock/timeout`);
  const observed = [l, r].map((x) => x.ok ? 'ok' : x.text).join('\n---\n');
  if (!allowed(l, r, observed)) throw new Error(`${label} unexpected outcome: ${observed}`);
  psql(`assert-${label}`, `
    select task18_test.assert((select count(distinct side)=2 from task18_concurrency.events where label=${sqlQuote(label)} and detail='barrier-ready'),'${label} committed both barrier-ready rows');
    ${assertSql}
    select task18_concurrency.snapshot(${sqlQuote(label)}, '${f.job}'::uuid, '${f.task}'::uuid, '${f.evidence}'::uuid);
  `);
  console.log(`TASK18_RACE_PASSED: ${label}`);
}
function exactCompletionAssertions(f, schedulerExpected = true) {
  return `
    with state as (select (select status='confirmed_posted_manual' from public.creator_publishing_queue_tasks where id='${f.task}'::uuid) as completion_won)
    select task18_test.assert(case when completion_won then (select count(*)=1 from public.creator_publishing_operator_action_idempotency where platform_job_id='${f.job}'::uuid and action_type='manual_completion') else (select count(*)=0 from public.creator_publishing_operator_action_idempotency where platform_job_id='${f.job}'::uuid and action_type='manual_completion') end,'exact manual-completion idempotency count for ${f.job}') from state;
    with state as (select (select status='confirmed_posted_manual' from public.creator_publishing_queue_tasks where id='${f.task}'::uuid) as completion_won)
    select task18_test.assert(case when completion_won then (select count(*)=1 from public.creator_publishing_audit_events where entity_id='${f.task}'::uuid and action='operator_onlyfans_manual_completion') else (select count(*)=0 from public.creator_publishing_audit_events where entity_id='${f.task}'::uuid and action='operator_onlyfans_manual_completion') end,'exact queue completion audit count for ${f.task}') from state;
    with state as (select (select status='confirmed_posted_manual' from public.creator_publishing_queue_tasks where id='${f.task}'::uuid) as completion_won)
    select task18_test.assert(case when completion_won then (select count(*)=1 from public.creator_publishing_audit_events where entity_id='${f.job}'::uuid and action='operator_onlyfans_manual_completion') else (select count(*)=0 from public.creator_publishing_audit_events where entity_id='${f.job}'::uuid and action='operator_onlyfans_manual_completion') end,'exact job completion audit count for ${f.job}') from state;
    with state as (select (select status='confirmed_posted_manual' from public.creator_publishing_queue_tasks where id='${f.task}'::uuid) as completion_won)
    select task18_test.assert(case when completion_won then (select count(*)=1 from public.creator_publishing_audit_events where entity_id='${f.plan}'::uuid and action='operator_onlyfans_manual_completion_plan_recomputed') else (select count(*)=0 from public.creator_publishing_audit_events where entity_id='${f.plan}'::uuid and action='operator_onlyfans_manual_completion_plan_recomputed') end,'exact plan recomputation audit count for ${f.plan}') from state;
    with state as (select (select status='confirmed_posted_manual' from public.creator_publishing_queue_tasks where id='${f.task}'::uuid) as completion_won)
    select task18_test.assert(case when completion_won and ${schedulerExpected ? 'true' : 'false'} then (select count(*)=1 from public.creator_publishing_audit_events where entity_id='${f.scheduler}'::uuid and action='operator_onlyfans_manual_completion_scheduler_superseded') when completion_won then true else (select count(*)=0 from public.creator_publishing_audit_events where entity_id='${f.scheduler}'::uuid and action='operator_onlyfans_manual_completion_scheduler_superseded') end,'exact scheduler supersession audit count for ${f.scheduler}') from state;
    with state as (select (select status='confirmed_posted_manual' from public.creator_publishing_queue_tasks where id='${f.task}'::uuid) as completion_won)
    select task18_test.assert(case when completion_won then (select status='consumed' and consumed_at is not null from public.creator_publishing_operator_completion_evidence_intents where id='${f.evidence}'::uuid) else (select status<>'consumed' from public.creator_publishing_operator_completion_evidence_intents where id='${f.evidence}'::uuid) end,'evidence consumption matches completion outcome for ${f.evidence}') from state;
    select task18_test.assert(not exists(select 1 from public.creator_publishing_queue_tasks where id='${f.task}'::uuid and status='confirmed_posted_manual' and (posted_by is null or posted_at is null or posted_confirmation is not true or proof_screenshot_storage_key is null)),'no partial completion fields for ${f.task}');
  `;
}
function genericAssertions(f, extra = '') {
  return `${exactCompletionAssertions(f)}${extra}`;
}


try {
  psql('setup', `
    create schema if not exists task18_concurrency;
    create table if not exists task18_concurrency.events(label text not null, side text not null, detail text not null, barrier_at timestamptz, created_at timestamptz not null default now());
    create or replace function task18_concurrency.snapshot(p_label text,p_job uuid,p_task uuid,p_evidence uuid) returns void language plpgsql as $$
    begin
      insert into task18_concurrency.events(label,side,detail) select p_label,'state',jsonb_build_object('job_state',j.job_state,'queue_status',q.status,'evidence_status',e.status)::text from public.creator_publishing_platform_jobs j join public.creator_publishing_queue_tasks q on q.id=p_task join public.creator_publishing_operator_completion_evidence_intents e on e.id=p_evidence where j.id=p_job;
    end $$;
    select task18_test.assert(to_regprocedure('public.creator_publishing_complete_onlyfans_manual_post(text,uuid,uuid,text,uuid,text,text,text,integer,text,uuid)') is not null,'completion RPC exists for concurrency');
  `);
  const specs = [
    ['same-key same-request completion', {}, (f) => [completeSql(f, `race-${f.requestKey}`), completeSql(f, `race-${f.requestKey}`), genericAssertions(f, `select task18_test.assert((select status='confirmed_posted_manual' from public.creator_publishing_queue_tasks where id='${f.task}'::uuid),'same-key completed'); select task18_test.assert((select status='consumed' from public.creator_publishing_operator_completion_evidence_intents where id='${f.evidence}'::uuid),'same-key evidence consumed');`), (l, r) => l.ok && r.ok]],
    ['different-key completion', {}, (f) => [completeSql(f, `race-${f.requestKey}-a`), completeSql(f, `race-${f.requestKey}-b`), genericAssertions(f, `select task18_test.assert((select count(*)=1 from public.creator_publishing_operator_action_idempotency where platform_job_id='${f.job}'::uuid and action_type='manual_completion'),'one different-key completion winner');`), (_l, _r, text) => /WORK_NOT_COMPLETABLE|ok/.test(text)]],
    ['changed replay', {}, (f) => [completeSql(f, `race-${f.requestKey}`), completeSql(f, `race-${f.requestKey}`, { url: 'https://onlyfans.com/999/trusteduser' }), genericAssertions(f, `select task18_test.assert((select count(*)=1 from public.creator_publishing_operator_action_idempotency where platform_job_id='${f.job}'::uuid and idempotency_key='race-${f.requestKey}'),'changed replay keeps one stored request');`), (_l, _r, text) => /IDEMPOTENCY_CONFLICT|ok/.test(text)]],
    ['release versus completion', {}, (f) => [opSql('release', f), completeSql(f, `race-${f.requestKey}`), genericAssertions(f, `select task18_test.assert((select status in ('due_now','confirmed_posted_manual','cancelled','archived') from public.creator_publishing_queue_tasks where id='${f.task}'::uuid),'release versus completion final state valid');`), (_l, _r, text) => /CURRENT_CLAIM_REQUIRED|ok/.test(text)]],
    ['claim reassignment/token replacement versus completion', {}, (f) => [opSql('reassign', f), completeSql(f, `race-${f.requestKey}`), genericAssertions(f), (_l, _r, text) => /CURRENT_CLAIM_REQUIRED|ok|task18_queue_manual_completion_invariants/.test(text)]],
    ['expiry versus completion', {}, (f) => [opSql('expire', f), completeSql(f, `race-${f.requestKey}`), genericAssertions(f), (_l, _r, text) => /CURRENT_CLAIM_REQUIRED|ok/.test(text)]],
    ['authorization revocation versus completion', {}, (f) => [opSql('revoke', f), completeSql(f, `race-${f.requestKey}`), genericAssertions(f), (_l, _r, text) => /OPERATOR_NOT_AUTHORIZED|ok/.test(text)]],
    ['cancellation versus completion', {}, (f) => [opSql('cancel', f), completeSql(f, `race-${f.requestKey}`), genericAssertions(f), (_l, _r, text) => /WORK_NOT_COMPLETABLE|CANCELLATION|cancel|ok/i.test(text)]],
    ['source change versus completion', {}, (f) => [opSql('source', f), completeSql(f, `race-${f.requestKey}`), genericAssertions(f), (_l, _r, text) => /SOURCE_CHANGED|ok/.test(text)]],
    ['scheduler processing versus completion', { schedulerStatus: 'pending' }, (f) => [opSql('scheduler', f), completeSql(f, `race-${f.requestKey}`), genericAssertions(f, `select task18_test.assert(not exists(select 1 from public.creator_publishing_queue_tasks qt join public.creator_publishing_scheduler_events se on se.platform_job_id='${f.job}'::uuid where qt.id='${f.task}'::uuid and qt.status='confirmed_posted_manual' and se.status in ('pending','processing')),'completed work not pending or processing');`), (_l, _r, text) => /ok|WORK_NOT_COMPLETABLE/.test(text)]],
    ['evidence replacement versus completion', {}, (f) => [opSql('replace', f), completeSql(f, `race-${f.requestKey}`), genericAssertions(f), (_l, _r, text) => /EVIDENCE_MISMATCH|EVIDENCE_REPLACEMENT_TARGET_INVALID|ok/.test(text)]],
    ['evidence verification versus completion', { evidenceStatus: 'pending' }, (f) => [opSql('verify', f), completeSql(f, `race-${f.requestKey}`), genericAssertions(f), (_l, _r, text) => /EVIDENCE_MISMATCH|EVIDENCE_VERIFY_FAILED|ok/.test(text)]],
    ['replacement versus verification', { evidenceStatus: 'pending' }, (f) => [opSql('replace', f), opSql('verify', f), genericAssertions(f, `select task18_test.assert((select status in ('verified','invalidated') from public.creator_publishing_operator_completion_evidence_intents where id='${f.evidence}'::uuid),'replaced evidence cannot reopen');`), (_l, _r, text) => /EVIDENCE_REPLACEMENT_TARGET_INVALID|EVIDENCE_VERIFY_FAILED|ok/.test(text)]],
  ];
  let index = 1;
  for (const [label, options, build] of specs) {
    const fixture = fixtureSql(index++, options);
    psql(`fixture-${label}`, fixture.sql);
    const [left, right, assertions, allowed] = build(fixture);
    await race(label, fixture, left, right, assertions, allowed);
  }
  appendFileSync(logPath, `\nTASK18_CONCURRENCY_PASSED\ncompleted_at=${new Date().toISOString()}\n`);
  console.log('TASK18_CONCURRENCY_PASSED');
} catch (error) {
  appendFileSync(logPath, `\nFAILED: ${error?.stack || error}\ncompleted_at=${new Date().toISOString()}\n`);
  printTail();
  process.exit(1);
}
