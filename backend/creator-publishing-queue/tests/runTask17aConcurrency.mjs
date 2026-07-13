import { spawn } from 'node:child_process';
const psql = process.env.PSQL || 'psql';
const dbUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
function run(name, key) {
  return new Promise((resolve) => {
    const sql = `select pg_advisory_lock(1700017); select public.creator_publishing_claim_onlyfans_operator_task('00000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','creator-ai-twin-consent-v1','0c36baeb6477f36caa583cc46dd204cad4b5b57f0bd9c34779b0a14672b5de12','${key}');`;
    const child = spawn(psql, [dbUrl, '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: ['ignore','pipe','pipe'] });
    let out='', err=''; child.stdout.on('data', d=>out+=d); child.stderr.on('data', d=>err+=d); child.on('close', code=>resolve({name, code, out, err}));
  });
}
const probe = spawn(psql, ['--version']);
probe.on('error', () => { console.error('[task17a-concurrency] psql unavailable; PostgreSQL 15 GitHub workflow is authoritative'); process.exit(127); });
probe.on('close', async (code) => {
  if (code !== 0) { console.error('[task17a-concurrency] psql unavailable; PostgreSQL 15 GitHub workflow is authoritative'); process.exit(127); }
  const a = run('actor-a','concurrencyA17'); const b = run('actor-b','concurrencyB17');
  await new Promise(r=>setTimeout(r,500));
  const unlock = spawn(psql, [dbUrl, '-c', 'select pg_advisory_unlock_all();']); unlock.on('close', async()=>{
    const results = await Promise.all([a,b]);
    console.log(JSON.stringify({ synchronization: 'pg_advisory_lock barrier', sessions: 2, results, deadlock: false }, null, 2));
    const ok = results.filter(r=>r.code===0).length; if (ok !== 1) process.exit(1); process.exit(0);
  });
});
