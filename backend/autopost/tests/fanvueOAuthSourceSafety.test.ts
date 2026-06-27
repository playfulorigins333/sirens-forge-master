import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const oauth = readFileSync('lib/autopost/fanvueOAuth.ts', 'utf8')
const availability = readFileSync('lib/autopost/platformAvailability.ts', 'utf8')
const callback = readFileSync('app/api/autopost/connect/fanvue/callback/route.ts', 'utf8')
const statusRoute = readFileSync('app/api/autopost/platforms/me/route.ts', 'utf8')
const envExample = readFileSync('.env.example', 'utf8')

assert.match(oauth, /FANVUE_CONNECT_ENABLED"\) === "true"/, 'Fanvue connect must default off unless exactly true')
assert.match(oauth, /provider: "fanvue"/, 'Fanvue OAuth state must bind provider')
assert.match(oauth, /code_challenge_method", "S256"/, 'Fanvue OAuth must use PKCE S256')
assert.match(oauth, /FANVUE_OAUTH_SCOPES_UNAPPROVED/, 'Fanvue scopes must reject unapproved scopes')

assert.match(callback, /encryptAutopostToken\(tokenResponse\.access_token\)/, 'Fanvue access token must be encrypted before storage')
assert.match(callback, /encrypted_refresh_token: encryptedRefreshToken/, 'Fanvue refresh token must use encrypted storage')
assert.doesNotMatch(callback, /access_token:\s*tokenResponse/, 'Fanvue callback must not write legacy plaintext access_token')
assert.doesNotMatch(callback, /refresh_token:\s*tokenResponse/, 'Fanvue callback must not write legacy plaintext refresh_token')
assert.match(callback, /fetchFanvueIdentity/, 'Fanvue callback must verify identity before CONNECTED')
assert.match(callback, /connection_status: "CONNECTED"/, 'Fanvue callback may only set CONNECTED in verified callback path')

assert.match(availability, /public_selectable: false/, 'Fanvue must remain non-selectable')
assert.match(availability, /can_schedule: false/, 'Fanvue must remain non-schedulable')
assert.match(availability, /supports_real_posting: false/, 'Fanvue must not advertise real posting in FV-3')
assert.match(availability, /supports_async_dispatch: false/, 'Fanvue dispatch must remain unavailable')
assert.match(availability, /connection_blocker: connectionBlocker/, 'Fanvue status must expose a safe connection blocker')
assert.match(availability, /native_posting_available: false/, 'Fanvue native posting must remain unavailable')
assert.match(availability, /assisted_available: platform.supports_assisted_workflow/, 'Fanvue assisted workflow availability must remain explicit')
assert.match(availability, /FANVUE_PROVIDER_IDENTITY_MISSING/, 'Manual rows without provider identity must not count as connected')
assert.match(availability, /FANVUE_ENCRYPTED_ACCESS_TOKEN_MISSING/, 'Legacy or manual rows without encrypted tokens must not count as connected')
assert.match(availability, /FANVUE_IDENTITY_NOT_CONFIRMED/, 'Rows without FV-3 identity confirmation must not count as connected')

assert.match(statusRoute, /encrypted_access_token, encrypted_refresh_token, metadata/, 'Fanvue status lookup must include encrypted-token and metadata fields for validation')

assert.match(envExample, /FANVUE_CONNECT_ENABLED=false/, 'Fanvue connect env example must default off')
assert.match(envExample, /FANVUE_RUN_DISPATCH_ENABLED=false/, 'Fanvue dispatch env example must default off')
assert.match(envExample, /FANVUE_CLIENT_SECRET=\n/, 'Fanvue client secret placeholder must be empty')

console.log('Fanvue OAuth source safety checks passed')
