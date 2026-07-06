import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getAutopostPlatformRegistry } from '../../../lib/autopost/platformRegistry'

const sources = {
  diagnostic: readFileSync('lib/autopost/fanvueMediaReadinessDiagnostic.ts', 'utf8'),
  routeHelper: readFileSync('lib/autopost/fanvueMediaReadinessDiagnosticRoute.ts', 'utf8'),
  auth: readFileSync('lib/autopost/fanvueMediaReadinessDiagnosticAuth.ts', 'utf8'),
  route: readFileSync('app/api/admin/autopost/fanvue/media-readiness-diagnostic/route.ts', 'utf8'),
}

for (const [name, source] of Object.entries(sources)) {
  assert.doesNotMatch(source, /createFanvueTextPost|createFanvueMediaPost|readFanvuePost/, `${name} must not import post helpers`)
  assert.doesNotMatch(source, /autopost\/run|fanvueScheduleAdvance|calculateNextRunAtAfterPostedProof|persistAutopostJobResult/, `${name} must not import dispatch or scheduling modules`)
  assert.doesNotMatch(source, /platformRegistry/, `${name} must not import or edit platformRegistry`)
  if (name !== 'routeHelper') assert.doesNotMatch(source, /\/posts/, `${name} must not mention posts routes`)
}
assert.match(sources.routeHelper, /POST_RELATED_FIELD_FORBIDDEN/, 'route helper may mention posts only through denylist behavior')
assert.match(sources.diagnostic, /top_level_uuid_confirmed_for_diagnostic_use/, 'diagnostic must classify top-level uuid as diagnostic-scoped only')
assert.doesNotMatch(sources.diagnostic, /globally proven creatorUserUuid/i, 'diagnostic must not claim global creator UUID proof')
assert.match(sources.diagnostic, /candidate_creator_user_uuid_used/, 'diagnostic must return only safe creator UUID usage booleans')
assert.doesNotMatch(sources.diagnostic, /provider_media_uuid|provider_creator_uuid/, 'diagnostic result must not expose full provider identifiers')
assert.doesNotMatch(sources.diagnostic, /FANVUE_MEDIA_READINESS_DIAGNOSTIC_PNG[\s\S]*JSON.stringify/, 'diagnostic must not serialize media bytes')

const fanvue = getAutopostPlatformRegistry().find((platform) => platform.id === 'fanvue')
assert.ok(fanvue, 'Fanvue registry entry must exist')
assert.equal(fanvue?.public_selectable, false)
assert.equal(fanvue?.supports_real_posting, false)
assert.equal(fanvue?.supports_async_dispatch, false)

console.log('Fanvue media readiness diagnostic source safety checks passed')
