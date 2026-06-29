import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FANVUE_ADMIN_LIVE_PHOTO_UPLOAD_ENV,
  FANVUE_PHOTO_UPLOAD_CONFIRMATION,
  FANVUE_PHOTO_UPLOAD_OPERATION,
  guardFanvueUploadOnlyRoute,
  planFanvueLivePhotoUploadDryRun,
  redactSensitiveLogValue,
  safeUploadOnlySuccess,
  type FanvueLivePhotoUploadDependencies,
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
    signedPartUploader: async () => { throw new Error('signed upload should be blocked') },
    apiBaseUrl: 'https://api.test.fanvue.example',
    apiVersion: '2025-06-26',
  })
  assert.equal(blockedBeforeDeps.error_code, 'FANVUE_UPLOAD_LIVE_GATE_DISABLED')
  assert.equal(providerCalls, 0, 'flag false blocks before provider calls')

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

  const script = readFileSync('backend/autopost/admin/fanvueLivePhotoUploadDryRun.ts', 'utf8')
  assert.match(script, /DOTENV_CONFIG_PATH=\.env\.local/, 'local CLI runbook must document .env.local loading')
  assert.match(script, /DO NOT RUN UNTIL HUMAN APPROVES FV-40/, 'future live command must stay explicitly human-gated')
  assert.match(script, /FANVUE_RUN_DISPATCH_ENABLED=false/, 'future live command must keep dispatch disabled for the process')
  assert.match(script, /FANVUE_POST_VERIFY_ENABLED=false/, 'future live command must keep post verification disabled for the process')
  assert.match(script, /tokenCryptoCore/, 'admin runner must import CLI-safe token crypto core instead of server-only wrapper')
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
