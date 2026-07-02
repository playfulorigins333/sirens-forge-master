import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import {
  buildFanvuePostReconnectPreflightOutput,
  classifyFanvueTokenFreshness,
  isFanvuePostReconnectPreflightCliEntrypoint,
  parseFanvuePostReconnectPreflightArgs,
  planFanvuePostReconnectTokenPosturePreflight,
  runFanvuePostReconnectPreflightCliMain,
  type FanvuePostReconnectPreflightAccountRow,
} from '../admin/fanvuePostReconnectTokenPosturePreflight'

const userId = '123e4567-489b-42d3-a456-426614174000'
const nowMs = Date.parse('2026-07-02T00:00:00.000Z')
const secretPattern = /mock-access-token|mock-refresh-token|encrypted-access-token-placeholder|encrypted-refresh-token-placeholder|Authorization|Bearer|Basic|client_secret|X-Amz-Signature|https:\/\/signed-upload|raw provider response|Cookie|Set-Cookie/i

const baseAccount: FanvuePostReconnectPreflightAccountRow = {
  user_id: userId,
  platform: 'fanvue',
  connection_status: 'CONNECTED',
  provider_account_id: 'fanvue-account-1',
  provider_username: 'creator-handle',
  encrypted_access_token: 'encrypted-access-token-placeholder',
  encrypted_refresh_token: 'encrypted-refresh-token-placeholder',
  token_expires_at: new Date(nowMs + 60 * 60 * 1000).toISOString(),
  metadata: { provider: 'fanvue', identity_fetched: true, raw_provider_response: 'raw provider response must not leak' },
  scopes: ['read:self', 'read:media', 'write:media', 'openid', 'offline_access', 'offline'],
}

function assertNoSecrets(value: unknown) {
  const serialized = JSON.stringify(value)
  assert.doesNotMatch(serialized, secretPattern)
}

async function run() {
  assert.deepEqual(parseFanvuePostReconnectPreflightArgs(['--user-id', userId]), { userId, platform: 'fanvue' })
  assert.deepEqual(parseFanvuePostReconnectPreflightArgs(['--platform', 'fanvue', '--user-id', userId]), { userId, platform: 'fanvue' })

  let loadCalls = 0
  const happy = await planFanvuePostReconnectTokenPosturePreflight({ userId }, {
    nowMs: () => nowMs,
    loadAccount: async (targetUserId) => {
      loadCalls++
      assert.equal(targetUserId, userId)
      return baseAccount
    },
  })
  assert.equal(loadCalls, 1)
  assert.equal(happy.ok, true)
  assert.equal(happy.native_upload_readiness, 'ready_for_upload_only_gate')
  assert.deepEqual(happy.blockers, [])
  assert.equal(happy.connection_status, 'CONNECTED')
  assert.equal(happy.provider_account_id_present, true)
  assert.equal(happy.provider_username_present, true)
  assert.equal(happy.encrypted_access_token_present, true)
  assert.equal(happy.encrypted_refresh_token_present, true)
  assert.equal(happy.token_expires_at_present, true)
  assert.equal(happy.token_freshness, 'fresh')
  assert.equal(happy.metadata_provider_is_fanvue, true)
  assert.equal(happy.metadata_identity_fetched, true)
  assert.equal(happy.scopes_include_read_media, true)
  assert.equal(happy.scopes_include_write_media, true)
  assert.equal(happy.scopes_include_write_creator, false)
  assert.equal(happy.scopes_include_openid, true)
  assert.equal(happy.scopes_include_offline_access, true)
  assert.equal(happy.scopes_include_offline, true)
  assertNoSecrets(happy)

  const missingRefresh = buildFanvuePostReconnectPreflightOutput({ ...baseAccount, encrypted_refresh_token: null }, nowMs)
  assert.equal(missingRefresh.encrypted_refresh_token_present, false)
  assert.equal(missingRefresh.native_upload_readiness, 'blocked')
  assert.match(missingRefresh.blockers.join('|'), /encrypted refresh token missing/)
  assertNoSecrets(missingRefresh)

  for (const [expected, token_expires_at] of [
    ['expired', new Date(nowMs - 1000).toISOString()],
    ['near_expiry', new Date(nowMs + 2 * 60 * 1000).toISOString()],
    ['missing', null],
    ['invalid', 'not-a-date'],
  ] as const) {
    assert.equal(classifyFanvueTokenFreshness(token_expires_at, nowMs), expected)
    let providerCalls = 0
    const output = await planFanvuePostReconnectTokenPosturePreflight({ userId }, {
      nowMs: () => nowMs,
      loadAccount: async () => {
        providerCalls++ // row lookup only; no provider behavior is injected into this preflight
        return { ...baseAccount, token_expires_at }
      },
    })
    assert.equal(output.token_freshness, expected)
    assert.equal(output.native_upload_readiness, 'blocked')
    assert.equal(providerCalls, 1)
    assertNoSecrets(output)
  }
  assert.equal(classifyFanvueTokenFreshness(new Date(nowMs + 10 * 60 * 1000).toISOString(), nowMs), 'fresh')

  const missingRead = buildFanvuePostReconnectPreflightOutput({ ...baseAccount, scopes: ['write:media'] }, nowMs)
  assert.equal(missingRead.scopes_include_read_media, false)
  assert.match(missingRead.blockers.join('|'), /read:media scope missing/)
  const missingWrite = buildFanvuePostReconnectPreflightOutput({ ...baseAccount, scopes: ['read:media'] }, nowMs)
  assert.equal(missingWrite.scopes_include_write_media, false)
  assert.match(missingWrite.blockers.join('|'), /write:media scope missing/)
  const noWriteCreator = buildFanvuePostReconnectPreflightOutput({ ...baseAccount, scopes: ['read:media', 'write:media'] }, nowMs)
  assert.equal(noWriteCreator.scopes_include_write_creator, false)
  assert.equal(noWriteCreator.native_upload_readiness, 'ready_for_upload_only_gate')

  const missingRow = buildFanvuePostReconnectPreflightOutput(null, nowMs)
  assert.equal(missingRow.account_row_present, false)
  assert.match(missingRow.blockers.join('|'), /account row missing/)
  assert.equal(buildFanvuePostReconnectPreflightOutput({ ...baseAccount, connection_status: 'DISCONNECTED' }, nowMs).native_upload_readiness, 'blocked')
  assert.match(buildFanvuePostReconnectPreflightOutput({ ...baseAccount, provider_account_id: '' }, nowMs).blockers.join('|'), /provider account id missing/)
  assert.match(buildFanvuePostReconnectPreflightOutput({ ...baseAccount, metadata: { provider: 'other', identity_fetched: true } }, nowMs).blockers.join('|'), /metadata provider is not fanvue/)
  assert.match(buildFanvuePostReconnectPreflightOutput({ ...baseAccount, metadata: { provider: 'fanvue', identity_fetched: false } }, nowMs).blockers.join('|'), /metadata identity_fetched is not true/)

  const invalidUser = await planFanvuePostReconnectTokenPosturePreflight({ userId: 'not-a-uuid' }, { loadAccount: async () => { throw new Error('must not lookup invalid uuid') }, nowMs: () => nowMs })
  assert.equal(invalidUser.native_upload_readiness, 'blocked')
  assert.deepEqual(invalidUser.blockers, ['valid user id is required'])
  const invalidPlatform = await planFanvuePostReconnectTokenPosturePreflight({ userId, platform: 'x' }, { loadAccount: async () => { throw new Error('must not lookup invalid platform') }, nowMs: () => nowMs })
  assert.deepEqual(invalidPlatform.blockers, ['platform must be fanvue'])

  const mainOutput: string[] = []
  await runFanvuePostReconnectPreflightCliMain(['--user-id', userId], (output) => mainOutput.push(output), {
    nowMs: () => nowMs,
    loadAccount: async () => baseAccount,
  })
  // Unit tests inject a mocked row lookup; they do not touch Supabase/live data.
  assert.equal(mainOutput.length, 1)
  assertNoSecrets(JSON.parse(mainOutput[0]))

  assert.equal(
    isFanvuePostReconnectPreflightCliEntrypoint(
      ['node', '/workspace/sirens-forge-master/backend/autopost/admin/fanvuePostReconnectTokenPosturePreflight.ts'],
      'file:///workspace/sirens-forge-master/backend/autopost/admin/fanvuePostReconnectTokenPosturePreflight.ts',
    ),
    true,
  )
  assert.equal(
    isFanvuePostReconnectPreflightCliEntrypoint(
      ['node', '/workspace/sirens-forge-master/backend/autopost/tests/fanvuePostReconnectTokenPosturePreflight.test.ts'],
      'file:///workspace/sirens-forge-master/backend/autopost/admin/fanvuePostReconnectTokenPosturePreflight.ts',
    ),
    false,
  )

  const script = readFileSync('backend/autopost/admin/fanvuePostReconnectTokenPosturePreflight.ts', 'utf8')
  assert.match(script, /select\("user_id, platform, connection_status, provider_account_id, provider_username, encrypted_access_token, encrypted_refresh_token, token_expires_at, metadata, scopes"\)/)
  assert.match(script, /maybeSingle\(\)/, 'preflight must be a row lookup only')
  assert.doesNotMatch(script, /decryptAutopostToken|decryptToken|refreshFanvueAccessToken|fanvueTokenRefresh|grant_type|token endpoint|createFanvueUploadSession|getFanvueUploadPartUrl|uploadFanvueSignedPart|completeFanvueUploadSession|waitForFanvueMediaReady/)
  assert.doesNotMatch(script, /fetch\(|api\.fanvue\.com|\/posts|insert\(|upsert\(|update\(|delete\(|rpc\(|from\("autopost_jobs"\)|from\('autopost_jobs'\)/)
  assert.doesNotMatch(script, /FANVUE_RUN_DISPATCH_ENABLED|FANVUE_POST_VERIFY_ENABLED|FANVUE_ADMIN_LIVE_PHOTO_UPLOAD_ENABLED/)

  for (const filename of readdirSync('supabase/migrations')) {
    assert.doesNotMatch(filename, /FV-40V|post.reconnect|preflight/i, 'FV-40V must not add migrations')
  }

  const runRoute = readFileSync('app/api/autopost/run/route.ts', 'utf8')
  const availability = readFileSync('lib/autopost/platformAvailability.ts', 'utf8')
  const registry = readFileSync('lib/autopost/platformRegistry.ts', 'utf8')
  assert.doesNotMatch(runRoute, /fanvue/i, 'Fanvue remains absent from public dispatch route')
  assert.match(availability, /public_selectable: false/, 'Fanvue remains not public-selectable')
  assert.match(availability, /can_schedule: false/, 'Fanvue remains not schedulable')
  assert.match(registry, /id: "fanvue"/, 'Fanvue registry entry remains present')
  assert.match(registry, /public_selectable: false/, 'Fanvue registry remains not public-selectable')
  assert.match(registry, /supports_real_posting: false/, 'Fanvue registry remains without real posting support')
  assert.match(registry, /supports_async_dispatch: false/, 'Fanvue registry remains without async dispatch support')

  const importOnlyOutput = execFileSync(
    process.execPath,
    ['--import', 'tsx', '-e', "await import('./backend/autopost/admin/fanvuePostReconnectTokenPosturePreflight.ts')"],
    { encoding: 'utf8', env: { ...process.env } },
  )
  assert.equal(importOnlyOutput, '', 'importing the preflight module must not auto-run main or print JSON')
}

run().then(() => console.log('Fanvue post-reconnect token posture preflight tests passed'))
