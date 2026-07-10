import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { execFileSync } from 'node:child_process'

const forbiddenHosts = ['onlyfans.com','www.onlyfans.com','fansly.com','www.fansly.com','apiv3.fansly.com','apifansly.com','fansly-api.com']
const networkTerms = ['fetch','axios','request','got','undici','node-fetch','http.','https.','superagent','playwright','puppeteer','webdriver']
const credentialNames = ['password','access_token','refresh_token','auth_token','session','session_id','cookie','cookies','two_factor_secret','recovery_code','platform_secret']
const scanGlobs = ['lib/creator-publishing-queue','backend/creator-publishing-queue','app/api/creator-publishing-queue']
const migration = 'supabase/migrations/20260710000100_creator_publishing_queue_foundation.sql'

function filesUnder(paths: string[]) {
  const args = ['--files', ...paths.filter((path) => existsSync(path))]
  try { return execFileSync('rg', args, { encoding: 'utf8' }).trim().split('\n').filter(Boolean) } catch { return [] }
}

export function findForbiddenNetworkCalls(files: string[]) {
  const findings: string[] = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8').toLowerCase()
    if (!forbiddenHosts.some((host) => source.includes(host))) continue
    if (!networkTerms.some((term) => source.includes(term))) continue
    findings.push(file)
  }
  return findings
}

export function findCredentialShapedQueueSchema(sql: string) {
  const findings: string[] = []
  const tableBlocks = Array.from(sql.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.(creator_(?:publishing|platform)[\w]*)\s*\(([\s\S]*?)\);/gi))
  for (const [, table, body] of tableBlocks) {
    for (const name of credentialNames) {
      const columnPattern = new RegExp(`(^|[,\\n])\\s*${name}\\s+`, 'i')
      if (columnPattern.test(body)) findings.push(`${table}.${name}`)
    }
  }
  return findings
}

function main() {
  const queueFiles = filesUnder(scanGlobs).filter((file) => !file.includes('/fixtures/') && !file.includes('/tests/'))
  const networkFindings = findForbiddenNetworkCalls(queueFiles)
  assert.deepEqual(networkFindings, [], `Forbidden creator publishing queue network egress references: ${networkFindings.join(', ')}`)

  const sql = readFileSync(migration, 'utf8')
  const credentialFindings = findCredentialShapedQueueSchema(sql)
  assert.deepEqual(credentialFindings, [], `Credential-shaped queue schema fields: ${credentialFindings.join(', ')}`)

  console.log('Creator Publishing Queue safety guard passed')
}

if (process.argv[1] && relative(process.cwd(), process.argv[1]).endsWith('creatorPublishingQueueSafetyGuard.ts')) main()
