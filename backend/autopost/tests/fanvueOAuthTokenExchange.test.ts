import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildFanvueTokenExchangeRequestInit } from '../../../lib/autopost/fanvueOAuthTokenExchange'

function withAuthMethod<T>(value: string | null, run: () => T) {
  const previous = process.env.FANVUE_OAUTH_CLIENT_AUTH_METHOD
  if (value === null) delete process.env.FANVUE_OAUTH_CLIENT_AUTH_METHOD
  else process.env.FANVUE_OAUTH_CLIENT_AUTH_METHOD = value
  try {
    return run()
  } finally {
    if (previous === undefined) delete process.env.FANVUE_OAUTH_CLIENT_AUTH_METHOD
    else process.env.FANVUE_OAUTH_CLIENT_AUTH_METHOD = previous
  }
}

function build() {
  return buildFanvueTokenExchangeRequestInit({
    clientId: 'mock-client-id',
    clientSecret: 'mock-client-secret',
    code: 'mock-oauth-code',
    redirectUri: 'https://example.invalid/api/autopost/connect/fanvue/callback',
    codeVerifier: 'mock-code-verifier',
  })
}

function assertAuthorizationCodeBody(request: ReturnType<typeof buildFanvueTokenExchangeRequestInit>) {
  assert.equal(request.headers['content-type'], 'application/x-www-form-urlencoded')
  assert.equal(request.body.get('grant_type'), 'authorization_code')
  assert.equal(request.body.get('code'), 'mock-oauth-code')
  assert.equal(request.body.get('redirect_uri'), 'https://example.invalid/api/autopost/connect/fanvue/callback')
  assert.equal(request.body.get('code_verifier'), 'mock-code-verifier')
  assert.equal(request.body.has('scope'), false)
  assert.equal(request.body.has('refresh_token'), false)
}

const request = withAuthMethod(null, build)
assertAuthorizationCodeBody(request)
assert.equal('authorization' in request.headers, false)
assert.equal(request.body.get('client_id'), 'mock-client-id')
assert.equal(request.body.get('client_secret'), 'mock-client-secret')

const explicitBody = withAuthMethod('body', build)
assertAuthorizationCodeBody(explicitBody)
assert.equal('authorization' in explicitBody.headers, false)
assert.equal(explicitBody.body.get('client_id'), 'mock-client-id')
assert.equal(explicitBody.body.get('client_secret'), 'mock-client-secret')

const basic = withAuthMethod('basic', build)
assertAuthorizationCodeBody(basic)
assert.equal(basic.headers.authorization, `Basic ${Buffer.from('mock-client-id:mock-client-secret').toString('base64')}`)
assert.equal(basic.body.has('client_id'), false)
assert.equal(basic.body.has('client_secret'), false)

assert.throws(() => withAuthMethod('invalid', build), /FANVUE_OAUTH_CLIENT_AUTH_METHOD_INVALID/)

const callbackSource = readFileSync('app/api/autopost/connect/fanvue/callback/route.ts', 'utf8')
const helperSource = readFileSync('lib/autopost/fanvueOAuthTokenExchange.ts', 'utf8')
const clientAuthSource = readFileSync('lib/autopost/fanvueOAuthClientAuth.ts', 'utf8')
const refreshSource = readFileSync('lib/autopost/fanvueTokenRefresh.ts', 'utf8')
const exchangeSource = callbackSource.match(/async function exchangeCodeForTokens[\s\S]*?^}/m)?.[0] ?? ''
assert.match(exchangeSource, /buildFanvueTokenExchangeRequestInit/, 'callback must use the token exchange helper')
assert.match(helperSource, /applyFanvueOAuthClientAuth/, 'token exchange must share the Fanvue client auth helper')
assert.match(refreshSource, /applyFanvueOAuthClientAuth/, 'refresh must share the Fanvue client auth helper')
assert.match(clientAuthSource, /FANVUE_OAUTH_CLIENT_AUTH_METHOD/, 'shared helper must read the configured auth method')
assert.match(callbackSource, /verifySignedFanvueOAuthCookie/, 'callback must preserve signed state cookie verification')
assert.match(callbackSource, /statePayload\.state_hash !== sha256Base64Url\(returnedState\)/, 'callback must preserve state hash validation')
assert.match(callbackSource, /codeVerifier: statePayload\.code_verifier/, 'callback must preserve PKCE verifier use')

const serialized = JSON.stringify({ headers: { ...basic.headers, authorization: undefined }, safeBodyKeys: Array.from(basic.body.keys()) })
assert.doesNotMatch(serialized, /mock-client-secret|mock-oauth-code|mock-code-verifier|Authorization:|Basic [A-Za-z0-9+/=]+|access_token|refresh_token|cookie/i)

console.log('Fanvue OAuth token exchange mocked tests passed')
