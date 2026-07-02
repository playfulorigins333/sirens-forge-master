import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildFanvueTokenExchangeRequestInit } from '../../../lib/autopost/fanvueOAuthTokenExchange'

const request = buildFanvueTokenExchangeRequestInit({
  clientId: 'mock-client-id',
  clientSecret: 'mock-client-secret',
  code: 'mock-oauth-code',
  redirectUri: 'https://example.invalid/api/autopost/connect/fanvue/callback',
  codeVerifier: 'mock-code-verifier',
})

assert.equal(request.headers['content-type'], 'application/x-www-form-urlencoded')
assert.equal('authorization' in request.headers, false)
assert.equal(request.body.get('grant_type'), 'authorization_code')
assert.equal(request.body.get('client_id'), 'mock-client-id')
assert.equal(request.body.get('client_secret'), 'mock-client-secret')
assert.equal(request.body.get('code'), 'mock-oauth-code')
assert.equal(request.body.get('redirect_uri'), 'https://example.invalid/api/autopost/connect/fanvue/callback')
assert.equal(request.body.get('code_verifier'), 'mock-code-verifier')
assert.equal(request.body.has('scope'), false)
assert.equal(request.body.has('refresh_token'), false)

const callbackSource = readFileSync('app/api/autopost/connect/fanvue/callback/route.ts', 'utf8')
const helperSource = readFileSync('lib/autopost/fanvueOAuthTokenExchange.ts', 'utf8')
const exchangeSource = callbackSource.match(/async function exchangeCodeForTokens[\s\S]*?^}/m)?.[0] ?? ''
assert.match(exchangeSource, /buildFanvueTokenExchangeRequestInit/, 'callback must use the body-auth token exchange helper')
assert.doesNotMatch(exchangeSource, /authorization:\s*getBasicAuthHeader|Basic\s+\$\{?Buffer/, 'Fanvue token exchange must not use Basic auth')
assert.doesNotMatch(helperSource, /authorization:|Authorization|Basic|getBasicAuthHeader/, 'Fanvue token exchange helper must not use Basic auth')
assert.match(callbackSource, /verifySignedFanvueOAuthCookie/, 'callback must preserve signed state cookie verification')
assert.match(callbackSource, /statePayload\.state_hash !== sha256Base64Url\(returnedState\)/, 'callback must preserve state hash validation')
assert.match(callbackSource, /codeVerifier: statePayload\.code_verifier/, 'callback must preserve PKCE verifier use')

const serialized = JSON.stringify({ headers: request.headers, safeBodyKeys: Array.from(request.body.keys()) })
assert.doesNotMatch(serialized, /mock-client-secret|mock-oauth-code|mock-code-verifier|Authorization:|Basic [A-Za-z0-9+/=]+|access_token|refresh_token|cookie/i)

console.log('Fanvue OAuth token exchange mocked tests passed')
