import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  FANVUE_ADMIN_LIVE_PHOTO_UPLOAD_ENV,
  FANVUE_PHOTO_UPLOAD_CONFIRMATION,
  FANVUE_PHOTO_UPLOAD_OPERATION,
  guardFanvueUploadOnlyRoute,
  isFanvueLivePhotoUploadCliEntrypoint,
  planFanvueLivePhotoUploadDryRun,
  redactSensitiveLogValue,
  runFanvueLivePhotoUploadCliMain,
  safeUploadOnlySuccess,
  type FanvueLivePhotoUploadDependencies,
  validateFanvueAccessTokenFreshness,
  validateFanvueAccountForPhotoUpload,
  validateHardDisabledGate,
  validateLocalTestImageFile,
  validateNoPostPayload,
} from '../admin/fanvueLivePhotoUploadDryRun'

const userId = '123e4567-489b-42d3-a456-426614174000'
const filePath = '/tmp/fanvue-live-upload-test-photo.png'
const futureReadyArgs = { operation: FANVUE_PHOTO_UPLOAD_OPERATION, userId, filePath, confirm: FANVUE_PHOTO_UPLOAD_CONFIRMATION }
const liveEnv = { [FANVUE_ADMIN_LIVE_PHOTO_UPLOAD_ENV]: 'true' }

async function run() {
  let providerCalls = 0
  const defaultResult = await planFanvueLivePhotoUploadDryRun({})
  assert.equal(defaultResult.ok, false)
  assert.equal(defaultResult.provider_calls_attempted, false)
  assert.equal(providerCalls, 0, 'hard-disabled default must stop before provider calls')

  assert.equal(validateHardDisabledGate({ ...futureReadyArgs, confirm: undefined }, liveEnv)?.error_code, 'FANVUE_UPLOAD_CONFIRMATION_REQUIRED')
  assert.equal(validateHardDisabledGate({ ...futureReadyArgs, confirm: 'WRONG' }, liveEnv)?.error_code, 'FANVUE_UPLOAD_CONFIRMATION_REQUIRED')
  assert.equal(validateHardDisabledGate(futureReadyArgs, {})?.error_code, 'FANVUE_UPLOAD_LIVE_GATE_DISABLED')
  assert.equal(validateHardDisabledGate({ ...futureReadyArgs, operation: 'post_photo' }, liveEnv)?.error_code, 'FANVUE_UPLOAD_OPERATION_INVALID')
  assert.equal(validateHardDisabledGate({ ...futureReadyArgs, userId: undefined }, liveEnv)?.error_code, 'FANVUE_UPLOAD_USER_ID_REQUIRED')
  assert.equal(validateHardDisabledGate({ ...futureReadyArgs, userId: 'not-a-uuid' }, liveEnv)?.error_code, 'FANVUE_UPLOAD_USER_ID_REQUIRED')
  assert.equal(validateHardDisabledGate({ ...futureReadyArgs, filePath: undefined }, liveEnv)?.error_code, 'FANVUE_UPLOAD_FILE_REQUIRED')

  for (const field of ['caption', 'text', 'audience', 'publishAt', 'expiresAt', 'collectionUuids', 'mediaPreviewUuid', 'post', 'postUuid', 'platform_post_id']) {
    assert.equal(validateNoPostPayload({ [field]: 'blocked' })?.error_code, 'FANVUE_UPLOAD_POST_FIELD_REJECTED', `${field} must be rejected`)
  }
  assert.equal(validateNoPostPayload({ route: '/posts' })?.error_code, 'FANVUE_UPLOAD_POST_ROUTE_REJECTED')

  assert.equal(guardFanvueUploadOnlyRoute('POST', 'https://api.example.test/media/uploads').ok, true)
  assert.equal(guardFanvueUploadOnlyRoute('GET', 'https://api.example.test/media/uploads/upload_1/parts/1/url?x=1').ok, true)
  assert.equal(guardFanvueUploadOnlyRoute('PATCH', 'https://api.example.test/media/uploads/upload_1').ok, true)
  assert.equal(guardFanvueUploadOnlyRoute('GET', 'https://api.example.test/media/223e4567-e89b-42d3-a456-426614174000').ok, true)
  assert.equal(guardFanvueUploadOnlyRoute('POST', 'https://api.example.test/posts').error_code, 'FANVUE_POST_ROUTE_FORBIDDEN')
  assert.equal(guardFanvueUploadOnlyRoute('GET', 'https://api.example.test/posts/123').error_code, 'FANVUE_POST_ROUTE_FORBIDDEN')
  assert.equal(guardFanvueUploadOnlyRoute('GET', 'https://api.example.test/creators/abc/media').error_code, 'FANVUE_CREATOR_ROUTE_FORBIDDEN')
  assert.equal(guardFanvueUploadOnlyRoute('GET', 'https://api.example.test/media/uploads/upload_1').error_code, 'FANVUE_UPLOAD_ROUTE_NOT_ALLOWED')
  assert.equal(guardFanvueUploadOnlyRoute('POST', 'https://api.example.test/creators').error_code, 'FANVUE_CREATOR_ROUTE_FORBIDDEN')

  const baseAccount = {
    user_id: userId,
    platform: 'fanvue',
    connection_status: 'CONNECTED',
    metadata: { provider: 'fanvue', identity_fetched: true },
    provider_account_id: 'fanvue-account-1',
    encrypted_access_token: 'encrypted-token-placeholder',
    encrypted_refresh_token: 'encrypted-refresh-token-placeholder',
    token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    token_type: 'Bearer',
    token_key_version: 1,
    last_refresh_at: null,
    scopes: ['read:self', 'read:media', 'write:media'],
  }
  assert.equal(validateFanvueAccountForPhotoUpload(null, userId).error_code, 'FANVUE_ACCOUNT_NOT_FOUND')
  assert.equal(validateFanvueAccountForPhotoUpload({ ...baseAccount, platform: 'x' }, userId).error_code, 'FANVUE_ACCOUNT_PLATFORM_INVALID')
  assert.equal(validateFanvueAccountForPhotoUpload({ ...baseAccount, connection_status: 'DISCONNECTED' }, userId).error_code, 'FANVUE_ACCOUNT_NOT_CONNECTED')
  assert.equal(validateFanvueAccountForPhotoUpload({ ...baseAccount, metadata: null }, userId).error_code, 'FANVUE_ACCOUNT_PROVIDER_INVALID')
  assert.equal(validateFanvueAccountForPhotoUpload({ ...baseAccount, metadata: { provider: 'fanvue' } }, userId).error_code, 'FANVUE_ACCOUNT_IDENTITY_UNCONFIRMED')
  assert.equal(validateFanvueAccountForPhotoUpload({ ...baseAccount, provider_account_id: null }, userId).error_code, 'FANVUE_PROVIDER_ACCOUNT_ID_REQUIRED')
  assert.equal(validateFanvueAccountForPhotoUpload({ ...baseAccount, encrypted_access_token: null }, userId).error_code, 'FANVUE_ENCRYPTED_ACCESS_TOKEN_REQUIRED')
  assert.equal(validateFanvueAccountForPhotoUpload({ ...baseAccount, scopes: ['read:media'] }, userId).error_code, 'FANVUE_MEDIA_SCOPES_MISSING')
  assert.equal(validateFanvueAccountForPhotoUpload({ ...baseAccount, scopes: ['write:media'] }, userId).error_code, 'FANVUE_MEDIA_SCOPES_MISSING')
  const validAccount = validateFanvueAccountForPhotoUpload(baseAccount, userId)
  assert.equal(validAccount.ok, true)
  assert.equal(validAccount.writeCreatorRequired, false, 'write:creator must not be required')

  for (const [label, token_expires_at] of [
    ['missing', null],
    ['invalid', 'not-a-date'],
    ['expired', new Date(Date.now() - 60 * 1000).toISOString()],
    ['near-expired', new Date(Date.now() + 2 * 60 * 1000).toISOString()],
  ] as const) {
    const tokenFreshness = validateFanvueAccessTokenFreshness({ token_expires_at })
    assert.equal(tokenFreshness.ok, false, `${label} token expiry must block`)
    assert.equal(tokenFreshness.error_code, 'FANVUE_TOKEN_FRESHNESS_REQUIRED')
    assert.equal(tokenFreshness.provider_calls_attempted, false)
    assert.equal(tokenFreshness.posted_proof, false)
    assert.equal(tokenFreshness.platform_post_id, null)
  }
  assert.equal(validateFanvueAccessTokenFreshness({ token_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }).ok, true)

  assert.equal(redactSensitiveLogValue('https://signed-upload.invalid/part-1?X-Amz-Signature=secret'), 'https://signed-upload.invalid/part-1')
  assert.equal(redactSensitiveLogValue('Authorization=Bearer super-secret-token'), 'Authorization=Bearer [REDACTED]')
  assert.doesNotMatch(JSON.stringify(redactSensitiveLogValue('https://signed-upload.invalid/part-1?secret=value')), /secret=value/)

  const uploadOnly = safeUploadOnlySuccess({ provider_media_uuid: '223e4567-e89b-42d3-a456-426614174000', attempts: 3 })
  assert.equal(uploadOnly.posted_proof, false)
  assert.equal(uploadOnly.platform_post_id, null)

  assert.equal((await validateLocalTestImageFile('https://example.test/photo.jpg')).error_code, 'FANVUE_UPLOAD_REMOTE_FILE_REJECTED')
  assert.equal((await validateLocalTestImageFile('/tmp/.hidden.jpg')).error_code, 'FANVUE_UPLOAD_HIDDEN_FILE_REJECTED')
  assert.equal((await validateLocalTestImageFile('/tmp/client_secret.jpg')).error_code, 'FANVUE_UPLOAD_SUSPICIOUS_FILENAME_REJECTED')
  assert.equal((await validateLocalTestImageFile('/tmp/photo.gif')).error_code, 'FANVUE_UPLOAD_IMAGE_TYPE_REJECTED')
  assert.equal((await validateLocalTestImageFile('/tmp/photo.jpg', async () => Buffer.from([]))).error_code, 'FANVUE_UPLOAD_EMPTY_FILE_REJECTED')
  assert.equal((await validateLocalTestImageFile('/tmp/photo.jpg', async () => Buffer.from('not-a-jpeg'))).error_code, 'FANVUE_UPLOAD_IMAGE_SIGNATURE_REJECTED')
  assert.equal((await validateLocalTestImageFile('/tmp/photo.png', async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]))).ok, true)


  const blockedBeforeDeps = await planFanvueLivePhotoUploadDryRun(futureReadyArgs, {}, {
    loadAccount: async () => { providerCalls++; return baseAccount },
    decryptToken: () => 'token',
    readFileBytes: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
    fanvueFetch: async () => { throw new Error('provider call should be blocked') },
    refreshFanvueAccessToken: async () => { throw new Error('refresh should be blocked by disabled gate') },
    signedPartUploader: async () => { throw new Error('signed upload should be blocked') },
    apiBaseUrl: 'https://api.test.fanvue.example',
    apiVersion: '2025-06-26',
  })
  assert.equal(blockedBeforeDeps.error_code, 'FANVUE_UPLOAD_LIVE_GATE_DISABLED')
  assert.equal(providerCalls, 0, 'flag false blocks before provider calls')

  for (const [label, token_expires_at] of [
    ['missing', null],
    ['invalid', 'not-a-date'],
    ['expired', new Date(Date.now() - 60 * 1000).toISOString()],
    ['near-expired', new Date(Date.now() + 2 * 60 * 1000).toISOString()],
  ] as const) {
    let localProviderCalls = 0
    let decryptCalls = 0
    const stale = await planFanvueLivePhotoUploadDryRun(futureReadyArgs, liveEnv, {
      loadAccount: async () => ({ ...baseAccount, token_expires_at, encrypted_refresh_token: null }),
      decryptToken: () => { decryptCalls++; return 'access-token-must-not-be-used' },
      readFileBytes: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
      fanvueFetch: async () => { localProviderCalls++; throw new Error('provider call should be blocked by stale token') },
      signedPartUploader: async () => { localProviderCalls++; throw new Error('signed upload should be blocked by stale token') },
      apiBaseUrl: 'https://api.test.fanvue.example',
      apiVersion: '2025-06-26',
    })
    assert.equal(stale.ok, false, `${label} token expiry must block the upload path`)
    assert.equal(stale.error_code, 'FANVUE_REFRESH_TOKEN_MISSING')
    assert.equal(stale.provider_calls_attempted, false)
    assert.equal(stale.posted_proof, false)
    assert.equal(stale.platform_post_id, null)
    assert.equal(localProviderCalls, 0, `${label} token expiry with no refresh token must block before provider calls`)
    assert.equal(decryptCalls, 0, `${label} token expiry with no refresh token must block before token decrypt`)
    const serialized = JSON.stringify(stale, (_key, value) => redactSensitiveLogValue(value))
    assert.doesNotMatch(serialized, /access-token|refresh-token|encrypted-token|encrypted-refresh|X-Amz-Signature|raw provider body|Authorization:|Authorization=|Bearer [A-Za-z0-9]|Cookie:/i)
  }


  assert.equal(
    isFanvueLivePhotoUploadCliEntrypoint(
      ['node', '/workspace/sirens-forge-master/backend/autopost/admin/fanvueLivePhotoUploadDryRun.ts'],
      'file:///workspace/sirens-forge-master/backend/autopost/admin/fanvueLivePhotoUploadDryRun.ts',
    ),
    true,
    'POSIX tsx script argv path should be detected as the CLI entrypoint',
  )
  assert.equal(
    isFanvueLivePhotoUploadCliEntrypoint(
      ['node.exe', 'C:\\repo\\sirens-forge-master\\backend\\autopost\\admin\\fanvueLivePhotoUploadDryRun.ts'],
      'file:///C:/repo/sirens-forge-master/backend/autopost/admin/fanvueLivePhotoUploadDryRun.ts',
    ),
    true,
    'Windows tsx script argv path should be detected as the CLI entrypoint',
  )
  assert.equal(
    isFanvueLivePhotoUploadCliEntrypoint(
      ['node', '/workspace/sirens-forge-master/backend/autopost/tests/fanvueLivePhotoUploadDryRun.test.ts'],
      'file:///workspace/sirens-forge-master/backend/autopost/admin/fanvueLivePhotoUploadDryRun.ts',
    ),
    false,
    'importing from a test file must not be detected as running the admin CLI directly',
  )

  const mainOutput: string[] = []
  await runFanvueLivePhotoUploadCliMain(
    ['--operation', FANVUE_PHOTO_UPLOAD_OPERATION, '--user-id', userId, '--file', filePath, '--confirm', FANVUE_PHOTO_UPLOAD_CONFIRMATION],
    { [FANVUE_ADMIN_LIVE_PHOTO_UPLOAD_ENV]: 'false' },
    (output) => mainOutput.push(output),
  )
  const mainBlocked = JSON.parse(mainOutput[0])
  assert.equal(mainBlocked.ok, false)
  assert.equal(mainBlocked.blocked, true)
  assert.equal(mainBlocked.error_code, 'FANVUE_UPLOAD_LIVE_GATE_DISABLED')
  assert.equal(mainBlocked.provider_calls_attempted, false)
  assert.equal(mainBlocked.posted_proof, false)
  assert.equal(mainBlocked.platform_post_id, null)

  const calls: string[] = []
  const mediaUuid = '223e4567-e89b-42d3-a456-426614174000'
  const deps: FanvueLivePhotoUploadDependencies = {
    loadAccount: async (targetUserId) => {
      assert.equal(targetUserId, userId)
      return baseAccount
    },
    decryptToken: (encrypted) => {
      assert.equal(encrypted, 'encrypted-token-placeholder')
      return 'decrypted-token-never-logged'
    },
    readFileBytes: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
    fanvueFetch: async (url, init) => {
      providerCalls++
      calls.push(`${init.method} ${new URL(url).pathname}`)
      assert.doesNotMatch(url, /api\.fanvue\.com/, 'mocked test must not call live Fanvue API')
      const guarded = guardFanvueUploadOnlyRoute(init.method, url)
      assert.equal(guarded.ok, true)
      if (init.method === 'POST') {
        assert.equal(init.headers.authorization, 'Bearer decrypted-token-never-logged')
        assert.equal(init.headers.Authorization, undefined, 'admin upload should use the same lowercase authorization header key as Fanvue identity lookup')
        assert.equal(init.headers['X-Fanvue-API-Version'], '2025-06-26')
        assert.equal(init.headers['Content-Type'], 'application/json')
        assert.deepEqual(JSON.parse(init.body ?? '{}'), { name: 'fanvue-live-upload-test-photo.png', filename: 'fanvue-live-upload-test-photo.png', mediaType: 'image' })
      }
      if (init.method === 'POST') return { ok: true, status: 200, json: async () => ({ mediaUuid, uploadId: 'upload_1' }) }
      if (init.method === 'GET' && url.includes('/parts/1/url')) return { ok: true, status: 200, json: async () => 'https://signed-upload.invalid/part-1?X-Amz-Signature=secret' }
      if (init.method === 'PATCH') return { ok: true, status: 200, json: async () => ({ status: 'processing' }) }
      return { ok: true, status: 200, json: async () => ({ uuid: mediaUuid, status: 'ready', mediaType: 'image', name: 'photo.png' }) }
    },
    signedPartUploader: async ({ signedUrl, partNumber, body }) => {
      providerCalls++
      assert.equal(redactSensitiveLogValue(signedUrl), 'https://signed-upload.invalid/part-1')
      assert.equal(partNumber, 1)
      assert.ok(Buffer.isBuffer(body))
      return { ETag: 'mock-etag-1' }
    },
    apiBaseUrl: 'https://api.test.fanvue.example',
    apiVersion: '2025-06-26',
    sleep: async () => {},
  }
  const happy = await planFanvueLivePhotoUploadDryRun(futureReadyArgs, liveEnv, deps)
  assert.equal(happy.ok, true)
  assert.equal(happy.posted_proof, false)
  assert.equal(happy.platform_post_id, null)
  assert.deepEqual(calls, ['POST /media/uploads', 'GET /media/uploads/upload_1/parts/1/url', 'PATCH /media/uploads/upload_1', `GET /media/${mediaUuid}`])



  let refreshCalls = 0
  let refreshedDecryptSeen = false
  let refreshSuccessLoadCalls = 0
  const refreshSuccessCalls: string[] = []
  const refreshSuccessDeps: FanvueLivePhotoUploadDependencies = {
    ...deps,
    loadAccount: async () => {
      refreshSuccessLoadCalls++
      return refreshSuccessLoadCalls === 1
        ? { ...baseAccount, token_expires_at: new Date(Date.now() - 60 * 1000).toISOString(), encrypted_refresh_token: 'encrypted-refresh-token-placeholder' }
        : { ...baseAccount, token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), encrypted_access_token: 'encrypted-refreshed-access-token', encrypted_refresh_token: 'encrypted-refresh-token-placeholder' }
    },
    refreshFanvueAccessToken: async () => {
      refreshCalls++
      refreshSuccessCalls.push('refresh')
      return {
        ok: true,
        token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        token_type: 'Bearer',
        scopes: ['read:media', 'write:media'],
        refreshed: true,
      }
    },
    decryptToken: (encrypted) => {
      if (encrypted === 'encrypted-refreshed-access-token') {
        refreshedDecryptSeen = true
        return 'refreshed-access-token-never-logged'
      }
      throw new Error('stale access token must not be decrypted after refresh')
    },
    fanvueFetch: async (url, init) => {
      providerCalls++
      refreshSuccessCalls.push(`${init.method} ${new URL(url).pathname}`)
      assert.doesNotMatch(url, /api\.fanvue\.com/, 'mocked refresh-success upload must not call live Fanvue API')
      if (init.method === 'POST') assert.equal(init.headers.authorization, 'Bearer refreshed-access-token-never-logged')
      if (init.method === 'POST') return { ok: true, status: 200, json: async () => ({ mediaUuid, uploadId: 'upload_1' }) }
      if (init.method === 'GET' && url.includes('/parts/1/url')) return { ok: true, status: 200, json: async () => 'https://signed-upload.invalid/part-1?X-Amz-Signature=secret' }
      if (init.method === 'PATCH') return { ok: true, status: 200, json: async () => ({ status: 'processing' }) }
      return { ok: true, status: 200, json: async () => ({ uuid: mediaUuid, status: 'ready', mediaType: 'image', name: 'photo.png' }) }
    },
  }
  const refreshedHappy = await planFanvueLivePhotoUploadDryRun(futureReadyArgs, liveEnv, refreshSuccessDeps)
  assert.equal(refreshedHappy.ok, true)
  assert.equal(refreshCalls, 1, 'stale token with refresh token calls refresh once')
  assert.equal(refreshSuccessLoadCalls, 2, 'upload path reloads account after refresh persistence')
  assert.equal(refreshedDecryptSeen, true, 'upload path decrypts refreshed encrypted access token')
  assert.deepEqual(refreshSuccessCalls, ['refresh', 'POST /media/uploads', 'GET /media/uploads/upload_1/parts/1/url', 'PATCH /media/uploads/upload_1', `GET /media/${mediaUuid}`])
  assert.equal(refreshedHappy.posted_proof, false)
  assert.equal(refreshedHappy.platform_post_id, null)

  let refreshFailureUploadCalls = 0
  const refreshFailed = await planFanvueLivePhotoUploadDryRun(futureReadyArgs, liveEnv, {
    ...deps,
    loadAccount: async () => ({ ...baseAccount, token_expires_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(), encrypted_refresh_token: 'encrypted-refresh-token-placeholder' }),
    refreshFanvueAccessToken: async () => ({ ok: false, blocked: true, error_code: 'FANVUE_REFRESH_UNAUTHORIZED', safe_error_message: 'Fanvue refresh token is unauthorized or expired.', provider_calls_attempted: true, posted_proof: false, platform_post_id: null }),
    decryptToken: () => { throw new Error('refresh failure must not decrypt access token') },
    fanvueFetch: async () => { refreshFailureUploadCalls++; throw new Error('upload must not start after refresh failure') },
    signedPartUploader: async () => { refreshFailureUploadCalls++; throw new Error('signed upload must not start after refresh failure') },
  })
  assert.equal(refreshFailed.ok, false)
  assert.equal(refreshFailed.error_code, 'FANVUE_REFRESH_UNAUTHORIZED')
  assert.equal(refreshFailed.provider_calls_attempted, false)
  assert.equal(refreshFailed.posted_proof, false)
  assert.equal(refreshFailed.platform_post_id, null)
  assert.equal(refreshFailureUploadCalls, 0)
  assert.doesNotMatch(JSON.stringify(refreshFailed, (_key, value) => redactSensitiveLogValue(value)), /access-token|refresh-token|encrypted-token|encrypted-refresh|Authorization|Bearer|Basic|client-secret|signed-upload|raw provider|Cookie/i)

  const authFailureSteps = [
    { failed_step: 'create_upload_session', provider_route: 'POST /media/uploads' },
    { failed_step: 'get_signed_part_url', provider_route: 'GET /media/uploads/:uploadId/parts/1/url' },
    { failed_step: 'upload_signed_part', provider_route: 'PUT [signed-upload-url]' },
    { failed_step: 'complete_upload', provider_route: 'PATCH /media/uploads/:uploadId' },
    { failed_step: 'media_readback', provider_route: 'GET /media/:uuid' },
  ] as const
  for (const step of authFailureSteps) {
    for (const status of [401, 403] as const) {
      const authDeps: FanvueLivePhotoUploadDependencies = {
        ...deps,
        fanvueFetch: async (url, init) => {
          const pathname = new URL(url).pathname
          if (step.failed_step === 'create_upload_session' && init.method === 'POST') return { ok: false, status, json: async () => ({ raw_secret: 'raw provider body must not leak' }) }
          if (init.method === 'POST') return { ok: true, status: 200, json: async () => ({ mediaUuid, uploadId: 'upload_1' }) }
          if (step.failed_step === 'get_signed_part_url' && init.method === 'GET' && pathname.includes('/parts/1/url')) return { ok: false, status, json: async () => ({ raw_secret: 'raw provider body must not leak' }) }
          if (init.method === 'GET' && pathname.includes('/parts/1/url')) return { ok: true, status: 200, json: async () => 'https://signed-upload.invalid/part-1?X-Amz-Signature=secret' }
          if (step.failed_step === 'complete_upload' && init.method === 'PATCH') return { ok: false, status, json: async () => ({ raw_secret: 'raw provider body must not leak' }) }
          if (init.method === 'PATCH') return { ok: true, status: 200, json: async () => ({ status: 'processing' }) }
          if (step.failed_step === 'media_readback') return { ok: false, status, json: async () => ({ raw_secret: 'raw provider body must not leak' }) }
          return { ok: true, status: 200, json: async () => ({ uuid: mediaUuid, status: 'ready', mediaType: 'image', name: 'photo.png' }) }
        },
        signedPartUploader: async () => {
          if (step.failed_step === 'upload_signed_part') {
            throw {
              ok: false,
              kind: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
              status,
              error_code: status === 401 ? 'FANVUE_UNAUTHORIZED' : 'FANVUE_FORBIDDEN',
              safe_error_message: 'Fanvue rejected the request authorization.',
            }
          }
          return { ETag: 'mock-etag-1' }
        },
      }
      const failed = await planFanvueLivePhotoUploadDryRun(futureReadyArgs, liveEnv, authDeps)
      assert.equal(failed.ok, false)
      assert.equal(failed.error_code, 'FANVUE_UNAUTHORIZED')
      assert.equal(failed.safe_error_message, 'Fanvue rejected the request authorization.')
      assert.equal(failed.failed_step, step.failed_step)
      assert.equal(failed.provider_status, status)
      assert.equal(failed.provider_error_code, status === 401 ? 'FANVUE_UNAUTHORIZED' : 'FANVUE_FORBIDDEN')
      assert.equal(failed.provider_route, step.provider_route)
      assert.equal(failed.provider_calls_attempted, true)
      assert.equal(failed.posted_proof, false)
      assert.equal(failed.platform_post_id, null)
      const serialized = JSON.stringify(failed, (_key, value) => redactSensitiveLogValue(value))
      assert.doesNotMatch(serialized, /decrypted-token-never-logged|encrypted-token-placeholder|X-Amz-Signature|raw provider body|Authorization:|Authorization=|Bearer [A-Za-z0-9]|Cookie:/i)
    }
  }

  const script = readFileSync('backend/autopost/admin/fanvueLivePhotoUploadDryRun.ts', 'utf8')
  assert.match(script, /DOTENV_CONFIG_PATH=\.env\.local/, 'local CLI runbook must document .env.local loading')
  assert.match(script, /DO NOT RUN UNTIL HUMAN APPROVES FV-40/, 'future live command must stay explicitly human-gated')
  assert.match(script, /FANVUE_RUN_DISPATCH_ENABLED=false/, 'future live command must keep dispatch disabled for the process')
  assert.match(script, /FANVUE_POST_VERIFY_ENABLED=false/, 'future live command must keep post verification disabled for the process')
  assert.match(script, /tokenCryptoCore/, 'admin runner must import CLI-safe token crypto core instead of server-only wrapper')
  assert.match(script, /encrypted_refresh_token, token_expires_at, token_type, token_key_version, last_refresh_at/, 'admin account lookup must include token freshness fields')
  assert.match(script, /refreshFanvueAccessToken/, 'FV-40O wires the refresh helper into upload-only admin path')
  assert.doesNotMatch(script, /grant_type:\s*["']refresh_token/, 'upload runner must delegate refresh; it must not build token endpoint payloads inline')


  const importOnlyOutput = execFileSync(
    process.execPath,
    ['--import', 'tsx', '-e', "await import('./backend/autopost/admin/fanvueLivePhotoUploadDryRun.ts')"],
    { encoding: 'utf8', env: { ...process.env, FANVUE_ADMIN_LIVE_PHOTO_UPLOAD_ENABLED: 'false' } },
  )
  assert.equal(importOnlyOutput, '', 'importing the admin runner module must not auto-run main or print JSON')

  const cliOutput = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'backend/autopost/admin/fanvueLivePhotoUploadDryRun.ts',
      '--operation',
      FANVUE_PHOTO_UPLOAD_OPERATION,
      '--user-id',
      userId,
      '--file',
      filePath,
      '--confirm',
      FANVUE_PHOTO_UPLOAD_CONFIRMATION,
    ],
    { encoding: 'utf8', env: { ...process.env, FANVUE_ADMIN_LIVE_PHOTO_UPLOAD_ENABLED: 'false' } },
  )
  const cliBlocked = JSON.parse(cliOutput)
  assert.equal(cliBlocked.error_code, 'FANVUE_UPLOAD_LIVE_GATE_DISABLED')
  assert.equal(cliBlocked.provider_calls_attempted, false)
  assert.equal(cliBlocked.posted_proof, false)
  assert.equal(cliBlocked.platform_post_id, null)
  assert.doesNotMatch(script, /import\("\.\.\/\.\.\/\.\.\/lib\/autopost\/tokenCrypto"\)/, 'admin runner must not dynamically import server-only tokenCrypto wrapper')
  assert.doesNotMatch(script, /createFanvueMediaPost|createFanvueTextPost|readFanvuePost|postXTextOnlyAutopost|persistAutopostJobResult|calculateNextRunAtAfterPostedProof/)
  assert.doesNotMatch(script, /from\("autopost_jobs"\)|from\('autopost_jobs'\)/)

  for (const unchanged of [
    'app/api/autopost/run/route.ts',
    'app/autopost/AutopostPageClient.tsx',
    'lib/autopost/platformAvailability.ts',
    'lib/autopost/platformRegistry.ts',
  ]) {
    // Read-only presence check: FV-37 test intentionally does not import or mutate public UI/run/availability code.
    assert.ok(readFileSync(unchanged, 'utf8').length > 0)
  }

  assert.ok(providerCalls > 0, 'only mocked provider/upload calls should occur')
}

run().then(() => console.log('Fanvue live photo upload dry-run upload-only admin runner tests passed'))
