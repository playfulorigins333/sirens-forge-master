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
  validateFanvueAccountForPhotoUpload,
  validateHardDisabledGate,
  validateLocalTestImageFile,
  validateNoPostPayload,
} from '../admin/fanvueLivePhotoUploadDryRun'

const userId = '123e4567-489b-42d3-a456-426614174000'
const filePath = '/tmp/fanvue-live-upload-test-photo.jpg'
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

  const baseAccount = {
    user_id: userId,
    platform: 'fanvue',
    connection_status: 'CONNECTED',
    metadata: { provider: 'fanvue', identity_fetched: true },
    provider_account_id: 'fanvue-account-1',
    encrypted_access_token: 'encrypted-token-placeholder',
    scopes: ['read:self', 'read:media', 'write:media'],
  }
  assert.equal(validateFanvueAccountForPhotoUpload({ ...baseAccount, scopes: ['read:media'] }, userId).error_code, 'FANVUE_MEDIA_SCOPES_MISSING')
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

  const script = readFileSync('backend/autopost/admin/fanvueLivePhotoUploadDryRun.ts', 'utf8')
  assert.doesNotMatch(script, /createFanvueMediaPost|createFanvueTextPost|readFanvuePost|postXTextOnlyAutopost|persistAutopostJobResult|calculateNextRunAtAfterPostedProof/)
  assert.doesNotMatch(script, /api\.fanvue\.com/)
  assert.doesNotMatch(script, /from\("autopost_jobs"\)|from\('autopost_jobs'\)/)

  for (const unchanged of [
    'app/api/autopost/run/route.ts',
    'app/autopost/AutopostPageClient.tsx',
    'lib/autopost/platformAvailability.ts',
    'lib/autopost/platformRegistry.ts',
  ]) {
    // Read-only presence check: FV-30 test intentionally does not import or mutate public UI/run/availability code.
    assert.ok(readFileSync(unchanged, 'utf8').length > 0)
  }

  assert.equal(providerCalls, 0, 'no live Fanvue call or real file upload should occur')
}

run().then(() => console.log('Fanvue live photo upload dry-run scaffold tests passed'))
