import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const url = process.env.PAYMENT_V2_DATABASE_URL || process.env.DATABASE_URL
if (!url) throw new Error('PAYMENT_V2_DATABASE_URL is required (disposable/local PostgreSQL only)')
const child = spawnSync(process.execPath, ['backend/affiliate/tests/runPfcCore03dPostgresIntegration.mjs'], {
  env: process.env,
  encoding: 'utf8',
})
if (child.status !== 0) throw new Error(child.stderr || child.stdout)

let assertions = 0
const run = (sql) => {
  const result = spawnSync('psql', [url, '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return (result.stdout || '').trim()
}
const file = (path) => {
  const result = spawnSync('psql', [url, '-XAt', '-v', 'ON_ERROR_STOP=1', '-f', path], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${path}: ${result.stderr || result.stdout}`)
}
const equal = (sql, expected, message) => {
  assert.equal(run(sql).split('\n').at(-1), String(expected), message)
  assertions++
}
const fails = (sql, pattern, message) => {
  assert.throws(() => run(sql), pattern, message)
  assertions++
}

file('supabase/migrations/20260807003300_affiliate_summary_payment_v2_read_boundary.sql')
run(`create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$`)

equal(`select has_table_privilege('service_role','public.affiliate_ledger','SELECT')`, 'f', 'service_role direct ledger SELECT remains denied')
equal(`select has_table_privilege('authenticated','public.affiliate_ledger','SELECT')`, 'f', 'authenticated direct ledger SELECT remains denied')
equal(`select has_table_privilege('anon','public.affiliate_ledger','SELECT')`, 'f', 'anon direct ledger SELECT remains denied')
equal(`select not coalesce((select proacl::text from pg_proc where oid='public.get_my_payment_v2_affiliate_ledger()'::regprocedure),'') like '%=X/%' and not has_function_privilege('anon','public.get_my_payment_v2_affiliate_ledger()','EXECUTE') and has_function_privilege('authenticated','public.get_my_payment_v2_affiliate_ledger()','EXECUTE') and not has_function_privilege('service_role','public.get_my_payment_v2_affiliate_ledger()','EXECUTE')`, 't', 'RPC ACL is authenticated-only')
equal(`select proowner='postgres'::regrole and prosecdef and proconfig=array['search_path=pg_catalog, pg_temp'] from pg_proc where oid='public.get_my_payment_v2_affiliate_ledger()'::regprocedure`, 't', 'RPC owner, SECURITY DEFINER, and search_path are fixed')

const affiliateAuth = '20000000-0000-4000-8000-000000000001'
const affiliateProfile = '10000000-0000-4000-8000-000000000001'
const otherAuth = '20000000-0000-4000-8000-000000000003'
const otherProfile = '10000000-0000-4000-8000-000000000003'
const ownLedgerIds = run(`select coalesce(string_agg(quote_literal(id::text),','),'') from public.affiliate_ledger where affiliate_user_id='${affiliateProfile}' and (payment_v2_purchase_id is not null or payment_v2_recurring_invoice_id is not null)`)
const otherLedgerIds = run(`select coalesce(string_agg(quote_literal(id::text),','),'') from public.affiliate_ledger where affiliate_user_id='${otherProfile}' and (payment_v2_purchase_id is not null or payment_v2_recurring_invoice_id is not null)`)
assert.ok(ownLedgerIds && otherLedgerIds, '03D fixture must contain both affiliates ledger rows')
equal(`begin; set local role authenticated; set local request.jwt.claim.sub='${affiliateAuth}'; select count(*)>0 and bool_and(id=any(array[${ownLedgerIds}]::uuid[])) from public.get_my_payment_v2_affiliate_ledger(); rollback`, 't', 'authenticated caller receives only its profile ledger data')
equal(`begin; set local role authenticated; set local request.jwt.claim.sub='${affiliateAuth}'; select count(*) from public.get_my_payment_v2_affiliate_ledger() where id=any(array[${otherLedgerIds}]::uuid[]); rollback`, '0', 'cross-user ledger rows are not returned')
fails(`begin; set local role authenticated; select * from public.get_my_payment_v2_affiliate_ledger(); rollback`, /authentication_required/, 'missing auth.uid fails closed')
fails(`begin; set local role authenticated; set local request.jwt.claim.sub='99999999-0000-4000-8000-000000000999'; select * from public.get_my_payment_v2_affiliate_ledger(); rollback`, /affiliate_profile_unavailable/, 'missing profile identity fails closed')
run(`insert into auth.users(id) values('29999999-0000-4000-8000-000000000999'); insert into public.profiles(id,user_id) values('19999999-0000-4000-8000-000000000998','29999999-0000-4000-8000-000000000999'),('19999999-0000-4000-8000-000000000999','29999999-0000-4000-8000-000000000999')`)
fails(`begin; set local role authenticated; set local request.jwt.claim.sub='29999999-0000-4000-8000-000000000999'; select * from public.get_my_payment_v2_affiliate_ledger(); rollback`, /affiliate_profile_unavailable/, 'duplicate profile identity fails closed')
const before = run(`select count(*)||'|'||coalesce(sum(commission_amount_cents),0)||'|'||string_agg(id::text||':'||status,',' order by id) from public.affiliate_ledger`)
run(`begin; set local role authenticated; set local request.jwt.claim.sub='${otherAuth}'; select * from public.get_my_payment_v2_affiliate_ledger(); rollback`)
equal(`select count(*)||'|'||coalesce(sum(commission_amount_cents),0)||'|'||string_agg(id::text||':'||status,',' order by id) from public.affiliate_ledger`, before, 'RPC performs no financial mutation')
equal(`select payment_v2_affiliate_public_cutover_ready() and exists(select 1 from pg_constraint where conname='affiliate_ledger_payment_v2_attribution') and exists(select 1 from pg_proc where oid='public.payment_v2_begin_payout_dispatch(uuid)'::regprocedure)`, 't', '03200 constraints and financial RPCs remain intact')

console.log(`PFC-CORE-03F PostgreSQL integration passed (${assertions} assertions; disposable database; includes full 03200 integration).`)
