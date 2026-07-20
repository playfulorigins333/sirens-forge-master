import assert from 'node:assert/strict'
import fs from 'node:fs'
const ui=fs.readFileSync('app/autopost/Task15PlanScheduling.tsx','utf8'), page=fs.readFileSync('app/autopost/page.tsx','utf8'), t14=fs.readFileSync('app/autopost/Task14AutopostOrchestration.tsx','utf8')
assert.match(ui,/confirm\(/,'explicit confirmation'); assert.match(ui,/localDate|localTime|scheduleTimezone|utcOffsetMinutes|intendedPublishAt/); assert.match(ui,/operatorDueLocalDate|operatorDueLocalTime|operatorDueAt/)
assert.doesNotMatch(ui,/useEffect\([^)]*fetch|setTimeout\([^)]*fetch|automaticRetry/i,'no auto-submit or automatic retry'); assert.doesNotMatch(ui,/scheduler\/run/)
assert.match(ui,/assisted\/manual/); assert.match(ui,/never logs into OnlyFans|never.*posts directly|will not log in or post/); assert.doesNotMatch(ui,/posts directly to OnlyFans\./)
assert.match(t14,/router\.refresh\(\)/,'refresh after plan creation'); assert.match(ui,/router\.refresh\(\)/,'refresh after confirmed scheduling and cancellation')
assert.match(ui,/same key|same idempotency key|keep the same idempotency key/); assert.match(ui,/setKey\(newKey\(\)\)/); assert.match(ui,/setCancelKey\(newKey\(\)\)/)
assert.match(ui,/occurrences.*map|Fall-back ambiguity requires explicit offset occurrence/s)
assert.match(page,/loadCreatorPublishingSchedulingView/); assert.match(page,/Task15PlanScheduling/)
assert.match(ui,/confirmCancelledReconciliation/); assert.equal((ui.match(/fetch\("\/api\/creator-publishing-queue\/scheduling\/cancel-plan/g)||[]).length,1,'no automatic retry during reconciliation')
console.log('task21PlanSchedulingUi ok')
