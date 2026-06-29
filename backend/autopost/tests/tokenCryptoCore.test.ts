import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decryptAutopostToken, encryptAutopostToken, getAutopostTokenKeyVersion } from '../../../lib/autopost/tokenCryptoCore'

const previousKey = process.env.AUTOPOST_TOKEN_ENCRYPTION_KEY
const previousVersion = process.env.AUTOPOST_TOKEN_KEY_VERSION

try {
  process.env.AUTOPOST_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
  process.env.AUTOPOST_TOKEN_KEY_VERSION = '1'

  const plaintext = 'mock-fanvue-access-token-for-local-cli-test'
  const encrypted = encryptAutopostToken(plaintext)

  assert.match(encrypted, /^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/)
  assert.notEqual(encrypted, plaintext)
  assert.equal(decryptAutopostToken(encrypted), plaintext)
  assert.equal(getAutopostTokenKeyVersion(), 1)

  process.env.AUTOPOST_TOKEN_ENCRYPTION_KEY = Buffer.alloc(31, 7).toString('base64')
  assert.throws(() => encryptAutopostToken('token'), /AUTOPOST_TOKEN_ENCRYPTION_KEY_INVALID/)

  const wrapper = readFileSync('lib/autopost/tokenCrypto.ts', 'utf8')
  assert.match(wrapper, /import "server-only"/, 'server-only wrapper must remain in place for app/server imports')
  assert.match(wrapper, /tokenCryptoCore/, 'server-only wrapper must re-export the CLI-safe core')

  console.log('Token crypto core tests passed')
} finally {
  if (previousKey === undefined) delete process.env.AUTOPOST_TOKEN_ENCRYPTION_KEY
  else process.env.AUTOPOST_TOKEN_ENCRYPTION_KEY = previousKey

  if (previousVersion === undefined) delete process.env.AUTOPOST_TOKEN_KEY_VERSION
  else process.env.AUTOPOST_TOKEN_KEY_VERSION = previousVersion
}
