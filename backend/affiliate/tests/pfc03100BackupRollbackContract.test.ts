import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

const backupPath = 'supabase/manual/pfc03100_pre_migration_backup.sql'
const rollbackPath = 'supabase/manual/pfc03100_rollback.sql'
for (const path of [backupPath, rollbackPath]) {
  assert.equal(existsSync(path), true, `${path} exists outside migrations`)
  assert.equal(path.includes('/migrations/'), false)
}
const backup = readFileSync(backupPath, 'utf8')
const rollback = readFileSync(rollbackPath, 'utf8')
const migration = readFileSync('supabase/migrations/20260807003100_payment_v2_affiliate_attribution.sql', 'utf8')
assert.equal(createHash('sha256').update(migration).digest('hex'), '1a3cf2e2ca71056f2ed6b8412208fbedf06b4a1d9605dfc2bb53efe87548b7cf')
assert.match(backup, /PFC03100_BACKUP_SET_ALREADY_EXISTS/)
for (const table of ['payment_v2_holds','payment_v2_purchases','payment_v2_reconciliation_evidence','affiliate_ledger','catalog_snapshot','manifest']) {
  assert.match(backup, new RegExp(`pfc03100_backup_${table}`))
}
assert.equal((backup.match(/enable row level security/gi) ?? []).length, 6)
assert.match(backup, /from public, anon, authenticated, service_role/i)
assert.match(backup, /source_counts <> backup_counts/)
assert.match(rollback, /PFC03100_UNSAFE_DRIFT/)
assert.match(rollback, /except select/)
assert.doesNotMatch(rollback, /drop table\s+public\.pfc03100_backup/i)
for (const sql of [backup, rollback]) {
  assert.doesNotMatch(sql, /20260805002900|schema_migrations|PAYMENT_FIRST_PUBLIC_CUTOVER_V2_ENABLED|PAYMENT_V2_EVENT_INBOX_ENABLED/i)
}
console.log('PFC-CORE-03C static backup/rollback contract passed.')
