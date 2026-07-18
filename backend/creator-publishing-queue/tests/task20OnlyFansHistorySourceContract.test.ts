import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const loader=readFileSync("lib/creator-publishing-queue/onlyfans-history/loaders.ts","utf8")
const resolution=readFileSync("lib/creator-publishing-queue/onlyfans-history/resolution.ts","utf8")
const timeline=readFileSync("app/creator/publishing-queue/OnlyFansHistoryTimeline.tsx","utf8")
const core=readFileSync("lib/creator-publishing-queue/onlyfans-history/core.ts","utf8")
const completionCore=readFileSync("lib/creator-publishing-queue/operator-completion/serviceCore.ts","utf8")

assert.match(loader,/select\("id,creator_id,target_platform"\)/)
assert.match(loader,/\.eq\("platform_job_id", job\.id\)[\s\S]*\.eq\("action_type", "manual_completion"\)/)
assert.match(loader,/creator_publishing_operator_completion_evidence_intents[\s\S]*\.eq\("platform_job_id", job\.id\)/)
assert.match(loader,/operator_onlyfans_manual_completion_proof_recorded|jobAuditEvents/)
assert.match(loader,/resolveQueueTaskIdFromJobLinks/)
assert.match(loader,/chooseHistoryQueueTask/)
assert.doesNotMatch(loader,/creator_publishing_queue_tasks[\s\S]{0,500}\.order\("updated_at", \{ ascending: false \}\)\.limit\(1\)/)
assert.ok(loader.indexOf("const evidenceIntents") < loader.indexOf("const task = await resolveTaskForJob"))
assert.ok(loader.indexOf("const idempotencyRows") < loader.indexOf("const task = await resolveTaskForJob"))

assert.match(resolution,/completion_proof_audit/)
assert.match(resolution,/manual_completion_idempotency/)
assert.match(resolution,/completion_evidence/)
assert.match(resolution,/if \(terminalJobStates\.has\(job\?\.job_state\)\) return null/)
assert.match(resolution,/exact\.length === 1 \? exact\[0\] : null/)

assert.doesNotMatch(timeline,/internal_request_snapshot|claim_token|request_fingerprint|server_path/)
assert.match(timeline,/<ol/)
assert.match(timeline,/<time dateTime=/)
assert.match(timeline,/noUrlReasonLabel\(entry\.noUrlReason\)/)
assert.doesNotMatch(timeline,/<dd>\{entry\.noUrlReason\}<\/dd>/)

for(const action of ["evidence_reserved","evidence_verified","evidence_superseded","evidence_failed","evidence_expired","evidence_consumed"]) assert.match(core,new RegExp(action))
assert.match(core,/id:`evidence:\$\{evidence\.id\}:\$\{lifecycle\.action\}`/)
assert.match(core,/replacesIntentId/)
assert.match(core,/replacedByIntentId/)
assert.match(completionCore,/creator_publishing_complete_onlyfans_manual_post_audited/g)

console.log("task20OnlyFansHistory source contract tests passed")
