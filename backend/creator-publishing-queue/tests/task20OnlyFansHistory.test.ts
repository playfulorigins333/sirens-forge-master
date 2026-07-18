import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { normalizeOnlyFansHistory } from "../../../lib/creator-publishing-queue/onlyfans-history/core"
import { normalizeHistoryTimezone, formatHistoryTimestamp } from "../../../lib/creator-publishing-queue/onlyfans-history/timezone"
const migration=readFileSync("supabase/migrations/20260718001700_creator_publishing_onlyfans_history_timeline.sql","utf8")
assert.match(migration,/creator_publishing_complete_onlyfans_manual_post_audited/)
assert.match(migration,/task20_onlyfans_completion_audit_once_uidx/)
assert.match(migration,/on conflict do nothing/)
assert.doesNotMatch(migration,/insert into public\.creator_publishing_audit_events[\s\S]*created_at\s*:=/)
assert.equal(normalizeHistoryTimezone("America/New_York"),"America/New_York")
assert.equal(normalizeHistoryTimezone(""),"UTC")
assert.equal(normalizeHistoryTimezone("Mars/Base"),"UTC")
assert.equal(formatHistoryTimestamp("2026-07-18T12:00:00.000Z","UTC"),"Jul 18, 2026 12:00:00 UTC")
const view=normalizeOnlyFansHistory({plan:{id:"plan",created_at:"2026-07-18T09:00:00.000Z"},job:{id:"job",publishing_plan_id:"plan",content_package_id:"pkg",schedule_timezone:"UTC",created_at:"2026-07-18T09:01:00.000Z"},task:{id:"task",status:"confirmed_posted_manual",posted_at:"2026-07-18T10:00:00.000Z",final_post_url:"https://onlyfans.com/1/user"},auditEvents:[{id:2,entity_type:"creator_publishing_queue_task",entity_id:"task",actor_id:"actor",action:"operator_onlyfans_manual_completion",after_state:{},created_at:"2026-07-18T10:00:00.000Z"},{id:3,entity_type:"creator_publishing_platform_job",entity_id:"job",actor_id:"actor",action:"operator_onlyfans_manual_completion_proof_recorded",after_state:{platform_job_id:"job",queue_task_id:"task",evidence_intent_id:"ev",final_post_url:"https://onlyfans.com/1/user",verified_sha256:"a".repeat(64),actual_size_bytes:123,normalized_mime_type:"image/png",completed_at:"2026-07-18T10:00:00.000Z"},created_at:"2026-07-18T10:00:00.000Z"}],evidenceIntents:[{id:"ev",status:"consumed",consumed_at:"2026-07-18T10:00:00.000Z",verified_sha256:"a".repeat(64),actual_size_bytes:123,normalized_mime_type:"image/png"}],schedulerEvents:[],idempotencyRows:[{internal_request_snapshot:{verified_sha256:"b".repeat(64)}}]},"operator")
assert.equal(view.ok,true)
if(view.ok){ assert.equal(view.entries.some(e=>e.provenance==="append_only_audit_evidence"),true); assert.equal(view.entries.some(e=>e.provenance==="immutable_evidence_row_data"),true); assert.equal(view.entries.some(e=>e.provenance==="reconstructed_completion_state"),false); assert.deepEqual(view.entries.map(e=>e.occurredAt), [...view.entries.map(e=>e.occurredAt)].sort()) }
const fallback=normalizeOnlyFansHistory({job:{id:"job",schedule_timezone:"Bad/Zone",created_at:"2026-07-18T09:00:00.000Z"},task:{id:"task",status:"confirmed_posted_manual",posted_at:"2026-07-18T11:00:00.000Z",final_post_url_skip_reason:"post_completed_without_shareable_url"},idempotencyRows:[{internal_request_snapshot:{evidence_intent_id:"ev",verified_sha256:"c".repeat(64),actual_size_bytes:55,normalized_mime_type:"image/jpeg"}}]},"creator")
assert.equal(fallback.ok,true)
if(fallback.ok){ assert.equal(fallback.timezone,"UTC"); assert.equal(fallback.entries.some(e=>e.provenance==="reconstructed_completion_state"),true) }
console.log("task20OnlyFansHistory tests passed")
