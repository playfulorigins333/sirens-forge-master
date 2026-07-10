import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const foundation = readFileSync('supabase/migrations/20260710000100_creator_publishing_queue_foundation.sql', 'utf8')
const correction = readFileSync('supabase/migrations/20260710000200_creator_publishing_compliance_manual_review_outcome.sql', 'utf8')
const sql = `${foundation}\n${correction}`

assert.match(correction, /check \(outcome in \('pass','block','manual_review','escalate'\)\)/, 'manual_review is an accepted compliance review outcome')
assert.match(correction, /outcome <> 'escalate' or length\(btrim\(coalesce\(escalated_approval_reason, ''\)\)\) > 0/, 'only escalate requires a nonblank escalation reason')
assert.doesNotMatch(correction, /outcome\s*=\s*'manual_review'[\s\S]*escalated_approved/, 'manual_review does not authorize escalated_approved')
assert.match(sql, /creator_publishing_escalated_approved_has_review[\s\S]*r\.outcome = 'escalate'[\s\S]*escalated_approval_reason/, 'escalated_approved remains authorized only by genuine escalate reviews')
assert.match(sql, /creator_publishing_content_not_approved_when_blocked_or_pending[\s\S]*creator_approval_status <> 'approved' or compliance_status not in \('blocked','pending'\)/, 'hard-block creator approval protection remains intact')
assert.doesNotMatch(correction, /creator_publishing_queue_tasks|ready_for_handoff|creator_approval_status\s*=\s*'approved'/, 'migration does not create queue tasks or approvals')

console.log('Creator Publishing Queue compliance migration tests passed')
