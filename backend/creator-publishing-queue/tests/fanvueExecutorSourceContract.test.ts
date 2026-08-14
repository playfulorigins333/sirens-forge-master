import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sources = {
  executor: readFileSync('lib/creator-publishing-queue/fanvue/executor.ts', 'utf8'),
  core: readFileSync('lib/autopost/fanvueProviderExecutorCore.ts', 'utf8'),
}
const forbidden = [
  'app/api/admin/autopost/fanvue',
  'backend/autopost/admin',
  'fanvueMediaReadinessDiagnostic',
  'FANVUE_MEDIA_READINESS_DIAGNOSTIC',
  'FANVUE_INTERNAL_SINGLE_POST_CONFIRMATION',
  'REQUEST_FANVUE_INTERNAL_SINGLE_POST',
  'autopost_rules',
  'autopost_jobs',
]
for (const [name, source] of Object.entries(sources)) {
  for (const value of forbidden) assert.equal(source.includes(value), false, `${name} contains forbidden source contract: ${value}`)
  assert.doesNotMatch(source, /fanvueInternalAdapter|fanvueInternalSinglePostRoute/)
  assert.doesNotMatch(source, /(?:\.|\b)publishAt\s*[:=]/, `${name} must not send provider-native scheduling input`)
}
assert.match(sources.core, /publishAt_used:\s*false/, 'safe scheduling telemetry remains explicit')
console.log('CPQ Fanvue executor source-contract tests passed')
