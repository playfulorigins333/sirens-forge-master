import assert from 'node:assert/strict'
import fs from 'node:fs'
const ui=fs.readFileSync('app/autopost/Task15PlanScheduling.tsx','utf8'), page=fs.readFileSync('app/autopost/page.tsx','utf8'), t14=fs.readFileSync('app/autopost/Task14AutopostOrchestration.tsx','utf8')
assert.match(ui,/confirm\(/); assert.match(ui,/localDate|localTime|scheduleTimezone|publicationUtcOffsetMinutes|intendedPublishAtUtc/); assert.match(ui,/operatorDueUtcOffsetMinutes|operatorDueAtUtc|operatorDueLocalDate|operatorDueLocalTime/)
assert.doesNotMatch(ui,/useEffect\([^)]*fetch|setTimeout\([^)]*fetch|automaticRetry/i); assert.doesNotMatch(ui,/scheduler\/run/)
assert.match(ui,/assisted\/manual/); assert.match(ui,/never logs into OnlyFans|never.*posts directly|will not log in or post/)
assert.match(t14,/router\.refresh\(\)/); assert.match(ui,/router\.refresh\(\)/)
assert.match(ui,/same key|same idempotency key|keep the same idempotency key/); assert.match(ui,/setKey\(newKey\(\)\)/); assert.match(ui,/setCancelKey\(newKey\(\)\)/)
assert.match(ui,/occurrences.*map|Fall-back ambiguity requires explicit offset occurrence/s); assert.match(ui,/confirmScheduleReconciliation/); assert.match(ui,/confirmCancelledReconciliation/)
assert.match(ui,/not an unschedule operation/); assert.match(ui,/cancels active scheduler events/); assert.match(ui,/archives active plan jobs/); assert.match(ui,/archives related operator queue work/); assert.match(ui,/may clear an active operator claim/); assert.match(ui,/cannot be undone through Phase B1/)
assert.equal((ui.match(/fetch\("\/api\/creator-publishing-queue\/scheduling\/cancel-plan/g)||[]).length,1); assert.equal((ui.match(/fetch\("\/api\/creator-publishing-queue\/scheduling\/schedule/g)||[]).length,1)
assert.match(page,/loadCreatorPublishingSchedulingView/); assert.match(page,/Task15PlanScheduling/)
console.log('task21PlanSchedulingUi ok')
