import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const adapter = readFileSync('lib/autopost/fanvueAdapter.ts', 'utf8')
const runRoute = readFileSync('app/api/autopost/run/route.ts', 'utf8')
const availability = readFileSync('lib/autopost/platformAvailability.ts', 'utf8')
const jobProof = readFileSync('lib/autopost/jobProof.ts', 'utf8')

assert.match(adapter, /import "server-only"/, 'Fanvue adapter must be server-only')
assert.match(adapter, /FANVUE_RUN_DISPATCH_ENABLED === "true"/, 'Fanvue adapter must require explicit dispatch gate')
assert.match(adapter, /path: "\/posts"/, 'Fanvue request builder prepares the official posts path only in isolated adapter')
assert.match(adapter, /authorization: `Bearer \$\{accessToken\}`/, 'Fanvue request builder requires in-memory bearer token')
assert.match(adapter, /"X-Fanvue-API-Version": apiVersion/, 'Fanvue request builder must include API version header')
assert.match(adapter, /audience = normalizeText\(input.audience\)/, 'Fanvue request builder must require explicit audience')
assert.match(adapter, /const body: FanvuePostRequest\["body"\] = \{ text, audience \}/, 'Fanvue create-post body must include official required audience')
assert.match(adapter, /publishAt = normalizeDraftTimestamp/, 'requested_publish_at must map only to publishAt request data')
assert.match(adapter, /FANVUE_MEDIA_UPLOAD_DEFERRED/, 'local media references must not become Fanvue media UUIDs')
assert.match(adapter, /FANVUE_MEDIA_UUID_INVALID/, 'Fanvue media UUIDs must be validated')
assert.match(adapter, /SCHEDULED_CREATED/, 'scheduled provider response must use non-POSTED internal result')
assert.match(adapter, /POSTED_READY_FOR_PROOF/, 'immediate provider response must remain pending proof integration')
assert.match(adapter, /verification_needed: true/, 'proof candidate must require later verification')
assert.doesNotMatch(adapter, /platform_post_id|posted_at|persistAutopostJobResult|from\("autopost_jobs"\)|fetch\(/, 'FV-6 adapter must not persist proof, set platform_post_id, or perform live fetch')

assert.doesNotMatch(runRoute, /fanvue/, 'Fanvue adapter must not be wired into public run route')
assert.match(availability, /public_selectable: false/, 'Fanvue must remain non-selectable')
assert.match(availability, /can_schedule: false/, 'Fanvue must remain non-schedulable')
assert.match(availability, /supports_real_posting: false/, 'Fanvue must remain not real-posting-enabled')
assert.match(availability, /supports_text_posting: false/, 'Fanvue public status must not advertise text posting')
assert.match(availability, /supports_media_posting: false/, 'Fanvue public status must not advertise media posting')
assert.match(jobProof, /export type AutopostProofPlatform = "x";/, 'strict proof validator must not accept Fanvue before FV-7')

console.log('Fanvue adapter foundation safety checks passed')
