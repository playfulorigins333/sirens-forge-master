import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const url = process.env.PAYMENT_V2_DATABASE_URL || process.env.DATABASE_URL
if (!url) throw new Error('PAYMENT_V2_DATABASE_URL is required (disposable/local PostgreSQL only)')
const child = spawnSync(process.execPath, ['backend/affiliate/tests/runPfcCore03dPostgresIntegration.mjs'], { env: process.env, encoding: 'utf8' })
if (child.status !== 0) throw new Error(child.stderr || child.stdout)

let assertions = 0
const psql = (args) => spawnSync('psql', [url, '-XqAt', '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8' })
const run = (sql) => { const result = psql(['-c', sql]); if (result.status !== 0) throw new Error(result.stderr || result.stdout); return (result.stdout || '').trim() }
const file = (path) => { const result = psql(['-f', path]); if (result.status !== 0) throw new Error(`${path}: ${result.stderr || result.stdout}`) }
const equal = (sql, expected, message) => { assert.equal(run(sql), String(expected), message); assertions++ }
const fails = (sql, pattern, message) => { assert.throws(() => run(sql), pattern, message); assertions++ }

const oldColumns = ['id','affiliate_user_id','referred_user_id','commission_amount_cents','gross_amount_cents','commission_percent','status','created_at','updated_at','payment_v2_purchase_id','referral_code_id','referrer_affiliate_tier','attribution_status','void_reason','voided_at','payment_v2_recurring_invoice_id']
equal(`select bool_and(has_column_privilege('service_role','public.affiliate_ledger',c,'SELECT')) from unnest(array[${oldColumns.map((c) => `'${c}'`).join(',')}]) c`, 't', '03100 and 03200 service-role column grants exist before 03300')
// The compact 03D fixture does not apply 03000; reproduce its Production payout-item read grant.
run(`grant select on public.affiliate_payout_items to service_role`)

file('supabase/migrations/20260807003300_affiliate_summary_payment_v2_read_boundary.sql')
run(`create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$`)
const noColumnSelect = (role) => `select not exists(select 1 from pg_attribute a where a.attrelid='public.affiliate_ledger'::regclass and a.attnum>0 and not a.attisdropped and has_column_privilege('${role}','public.affiliate_ledger',a.attname,'SELECT'))`

equal(`select has_table_privilege('service_role','public.affiliate_ledger','SELECT')`, 'f', 'service_role table SELECT is denied')
equal(noColumnSelect('service_role'), 't', 'service_role has no SELECT on any ledger column')
fails(`set role service_role; select id from public.affiliate_ledger`, /permission denied/, 'actual service_role direct SELECT fails')
equal(`select not has_table_privilege('authenticated','public.affiliate_ledger','SELECT') and (${noColumnSelect('authenticated').replace(/^select /,'')})`, 't', 'authenticated has no table or column SELECT')
equal(`select not has_table_privilege('anon','public.affiliate_ledger','SELECT') and (${noColumnSelect('anon').replace(/^select /,'')})`, 't', 'anon has no table or column SELECT')
equal(`select has_function_privilege('authenticated','public.get_my_affiliate_ledger_summary()','EXECUTE') and not has_function_privilege('service_role','public.get_my_affiliate_ledger_summary()','EXECUTE') and not has_function_privilege('anon','public.get_my_affiliate_ledger_summary()','EXECUTE')`, 't', 'RPC execution is authenticated-only')
equal(`select not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.get_my_affiliate_ledger_summary()'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE')`, 't', 'PUBLIC cannot execute RPC')
equal(`select proowner='postgres'::regrole and prosecdef and proconfig=array['search_path=pg_catalog, pg_temp'] from pg_proc where oid='public.get_my_affiliate_ledger_summary()'::regprocedure`, 't', 'RPC owner, SECURITY DEFINER, and search_path are fixed')

const affiliateAuth='20000000-0000-4000-8000-000000000001', affiliateProfile='10000000-0000-4000-8000-000000000001'
const otherAuth='20000000-0000-4000-8000-000000000003', otherProfile='10000000-0000-4000-8000-000000000003'
const ownIds=run(`select string_agg(quote_literal(id::text),',') from affiliate_ledger where affiliate_user_id='${affiliateProfile}'`)
const otherIds=run(`select string_agg(quote_literal(id::text),',') from affiliate_ledger where affiliate_user_id='${otherProfile}'`)
assert.ok(ownIds && otherIds, '03D fixture contains both affiliates')
equal(`begin; set local role authenticated; set local request.jwt.claim.sub='${affiliateAuth}'; select count(*)>0 and bool_and(id=any(array[${ownIds}]::uuid[])) from get_my_affiliate_ledger_summary(); rollback`, 't', 'caller receives only own profile rows')
equal(`begin; set local role authenticated; set local request.jwt.claim.sub='${affiliateAuth}'; select count(*) from get_my_affiliate_ledger_summary() where id=any(array[${otherIds}]::uuid[]); rollback`, '0', 'cross-user rows cannot be returned')
fails(`begin; set local role authenticated; select * from get_my_affiliate_ledger_summary(); rollback`, /authentication_required/, 'missing auth.uid fails closed')
fails(`begin; set local role authenticated; set local request.jwt.claim.sub='99999999-0000-4000-8000-000000000999'; select * from get_my_affiliate_ledger_summary(); rollback`, /affiliate_profile_unavailable/, 'missing profile fails closed')
run(`insert into auth.users(id) values('29999999-0000-4000-8000-000000000999'); insert into profiles(id,user_id) values('19999999-0000-4000-8000-000000000998','29999999-0000-4000-8000-000000000999'),('19999999-0000-4000-8000-000000000999','29999999-0000-4000-8000-000000000999')`)
fails(`begin; set local role authenticated; set local request.jwt.claim.sub='29999999-0000-4000-8000-000000000999'; select * from get_my_affiliate_ledger_summary(); rollback`, /affiliate_profile_unavailable/, 'duplicate profile fails closed')
const before=run(`select count(*)||'|'||sum(commission_amount_cents)||'|'||string_agg(id||':'||status,',' order by id) from affiliate_ledger`)
run(`begin; set local role authenticated; set local request.jwt.claim.sub='${otherAuth}'; select * from get_my_affiliate_ledger_summary(); rollback`)
equal(`select count(*)||'|'||sum(commission_amount_cents)||'|'||string_agg(id||':'||status,',' order by id) from affiliate_ledger`, before, 'RPC performs zero financial mutation')

const idsFor = (predicate) => run(`select string_agg(quote_literal(id::text),',') from affiliate_ledger where affiliate_user_id='${affiliateProfile}' and ${predicate}`)
const legacyIds=idsFor('payment_v2_purchase_id is null and payment_v2_recurring_invoice_id is null')
const initialIds=idsFor('payment_v2_purchase_id is not null')
const recurringIds=idsFor('payment_v2_recurring_invoice_id is not null')
const selfIds=idsFor("attribution_status='VOID_SELF_REFERRAL'")
assert.ok(legacyIds && initialIds && recurringIds && selfIds, '03D fixture contains every ledger classification')
equal(`begin; set local role authenticated; set local request.jwt.claim.sub='${affiliateAuth}'; select count(*)>0 from get_my_affiliate_ledger_summary() where id=any(array[${legacyIds}]::uuid[]); rollback`, 't', 'owning affiliate receives legacy ledger rows')
equal(`begin; set local role authenticated; set local request.jwt.claim.sub='${affiliateAuth}'; select bool_and(is_initial_payment_v2_purchase) from get_my_affiliate_ledger_summary() where id=any(array[${initialIds}]::uuid[]); rollback`, 't', 'initial Payment V2 rows are flagged true')
equal(`begin; set local role authenticated; set local request.jwt.claim.sub='${affiliateAuth}'; select count(*)>0 and bool_and(not is_initial_payment_v2_purchase) from get_my_affiliate_ledger_summary() where id=any(array[${recurringIds}]::uuid[]); rollback`, 't', 'recurring Payment V2 rows are flagged false')
equal(`begin; set local role authenticated; set local request.jwt.claim.sub='${affiliateAuth}'; select count(*)>0 and bool_and(is_void_self_referral) from get_my_affiliate_ledger_summary() where id=any(array[${selfIds}]::uuid[]); rollback`, 't', 'self-referral rows are flagged true')

const runtimeColumns = ['id','ledger_id','amount_cents','currency','source_charge_id','connect_destination','transfer_idempotency_key','execution_status','recurring_invoice_id']
equal(`begin; set local role service_role; select bool_and(has_column_privilege('service_role','public.affiliate_payout_items',c,'SELECT')) from unnest(array[${runtimeColumns.map((c) => `'${c}'`).join(',')}]) c; rollback`, 't', 'service_role can read every payout-item runtime field')
equal(`begin; set local role service_role; select count(*)>=1 from public.affiliate_payout_items where execution_status in('pending','dispatching') and recurring_invoice_id is not null; rollback`, 't', 'service_role can load recurring payout items without ledger access')
const dispatchableRecurringItem=run(`select i.id
from affiliate_payout_items i
join affiliate_ledger l on l.id=i.ledger_id
join payment_v2_affiliate_recurring_invoices r on r.id=i.recurring_invoice_id
join payment_v2_purchases p on p.id=r.payment_v2_purchase_id
join payment_v2_holds h on h.id=p.hold_id
left join profiles pr on pr.id=l.affiliate_user_id
where i.execution_status='pending' and i.attempt_count=0 and i.recurring_invoice_id is not null
  and l.status='available' and l.attribution_status='PURCHASER_ATTACHED' and l.referred_user_id is not null
  and l.payment_v2_recurring_invoice_id=i.recurring_invoice_id
  and r.reconciliation_status='RECONCILED' and r.commission_amount_cents is not distinct from l.commission_amount_cents
  and r.stripe_source_charge_id~'^ch_[A-Za-z0-9]+$' and r.currency~'^[a-z]{3}$' and r.commission_amount_cents>=0
  and (h.stripe_connect_destination~'^acct_[A-Za-z0-9]+$' or (h.stripe_connect_destination is null and pr.stripe_connect_onboarded is true and pr.stripe_connect_account_id~'^acct_[A-Za-z0-9]+$'))
order by r.stripe_subscription_id,r.paid_month_number,i.id limit 1`)
assert.ok(dispatchableRecurringItem, '03D fixture contains a recurring item satisfying every dispatch precondition')
equal(`select i.recurring_invoice_id=l.payment_v2_recurring_invoice_id from affiliate_payout_items i join affiliate_ledger l on l.id=i.ledger_id where i.id='${dispatchableRecurringItem}'`, 't', 'payout item carries the ledger recurring invoice identity')
equal(`begin; set local role service_role; select (payment_v2_get_payout_recurring_context('${dispatchableRecurringItem}') is not null); select payment_v2_begin_payout_dispatch('${dispatchableRecurringItem}')->>'execution_status'; rollback`, 't\ndispatching', 'valid recurring context reaches dispatching through SECURITY DEFINER RPCs')

const staleRecurringItem=run(`select i.id from affiliate_payout_items i join affiliate_ledger l on l.id=i.ledger_id join payment_v2_affiliate_recurring_invoices r on r.id=i.recurring_invoice_id where i.execution_status='pending' and i.attempt_count=0 and i.recurring_invoice_id is not null and r.commission_amount_cents is distinct from l.commission_amount_cents order by i.id limit 1`)
assert.ok(staleRecurringItem, '03D fixture retains a deliberately mismatched recurring payout item')
equal(`begin; set local role service_role; select payment_v2_begin_payout_dispatch('${staleRecurringItem}') is null; rollback`, 't', 'financially mismatched recurring item is refused dispatch')
equal(noColumnSelect('service_role'), 't', 'payout runtime proof restores no ledger column privilege')

equal(`select payment_v2_affiliate_public_cutover_ready()`, 't', 'strengthened readiness is true after 03300')
equal(`select exists(select 1 from pg_constraint where conname='affiliate_ledger_payment_v2_attribution') and exists(select 1 from pg_proc where oid='public.payment_v2_begin_payout_dispatch(uuid)'::regprocedure)`, 't', '03200 payout and reconciliation contracts remain intact')
run(`grant execute on function get_my_affiliate_ledger_summary() to service_role`)
equal(`select payment_v2_affiliate_public_cutover_ready()`, 'f', 'readiness fails when new RPC ACL is broken')
run(`revoke execute on function get_my_affiliate_ledger_summary() from service_role`)
equal(`select payment_v2_affiliate_public_cutover_ready()`, 't', 'readiness recovers when RPC ACL is restored')

console.log(`PFC-CORE-03F PostgreSQL integration passed (${assertions} assertions; disposable database; includes full 03200 integration).`)
