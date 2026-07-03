import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sources = [
  'lib/autopost/fanvueIdentityDiagnostic.ts',
  'lib/autopost/fanvueIdentityDiagnosticRoute.ts',
  'app/api/admin/autopost/fanvue/identity-diagnostic/route.ts',
]

function escaped(value: string) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
}

for (const path of sources) {
  const source = readFileSync(path, 'utf8')
  for (const forbidden of [
    '/media/uploads',
    'parts/{partNumber}/url',
    '/creators/',
    '/posts',
    'createFanvueUploadSession',
    'getFanvueUploadPartUrl',
    'uploadFanvueSignedPart',
    'completeFanvueUploadSession',
    'readFanvueMedia',
    'waitForFanvueMediaReady',
    'createFanvueMediaPost',
    'createFanvueTextPost',
    'readFanvuePost',
    'platformRegistry',
    'refreshFanvueAccessToken',
    'refreshAccessToken',
    'encrypted_refresh_token',
    'raw provider body',
  ]) {
    assert.doesNotMatch(source, escaped(forbidden), `${forbidden} must not appear in ${path}`)
  }
}

const combined = sources.map((path) => readFileSync(path, 'utf8')).join('\n')
for (const required of [
  '/users/account',
  'fanvue_identity_only_diagnostic',
  'upload_attempted: false',
  'signed_upload_url_attempted: false',
  'post_attempted: false',
  'dispatch_attempted: false',
  'scheduled: false',
]) {
  assert.match(combined, escaped(required), `${required} must appear in identity diagnostic source`)
}

console.log('Fanvue identity diagnostic source safety tests passed')
