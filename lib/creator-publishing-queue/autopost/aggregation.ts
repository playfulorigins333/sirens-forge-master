import type { JobState, PlanStatus } from "./types"
export const AUTOPOST_TERMINAL_SUCCESS_STATES = ["published_direct", "confirmed_posted_manual", "exported"] as const satisfies readonly JobState[]
export const AUTOPOST_TERMINAL_FAILURE_STATES = ["direct_publish_failed", "failed_manual_upload", "skipped", "blocked", "platform_rejected"] as const satisfies readonly JobState[]
export const AUTOPOST_SCHEDULED_STATES = ["scheduled_internally", "scheduled_on_platform", "retry_scheduled"] as const satisfies readonly JobState[]
export const AUTOPOST_ACTIVE_STATES = ["ready_to_publish", "direct_publish_queued", "publishing_direct", "awaiting_operator", "due_now", "claimed", "awaiting_post_confirmation"] as const satisfies readonly JobState[]
export const AUTOPOST_DRAFTISH_STATES = ["draft", "package_ready", "ready_for_export", "authentication_required", "needs_fix", "archived"] as const satisfies readonly JobState[]
const success = new Set<JobState>(AUTOPOST_TERMINAL_SUCCESS_STATES)
const failure = new Set<JobState>(AUTOPOST_TERMINAL_FAILURE_STATES)
const scheduled = new Set<JobState>(AUTOPOST_SCHEDULED_STATES)
const active = new Set<JobState>(AUTOPOST_ACTIVE_STATES)
export function isTerminalAutopostJobState(state: JobState){ return success.has(state) || failure.has(state) }
export function isActiveConflictAutopostJobState(state: JobState){ return !isTerminalAutopostJobState(state) }
export function aggregateAutopostPlanStatus(states:JobState[], currentStatus:PlanStatus="draft"):PlanStatus{ if(currentStatus==="cancelled") return "cancelled"; if(states.length===0) return "draft"; const s=states.filter(x=>success.has(x)).length; const f=states.filter(x=>failure.has(x)).length; if(s===states.length) return "completed"; if(f===states.length) return "completed_with_failures"; if(s>0&&f>0&&s+f===states.length) return "completed_with_failures"; if(s>0) return "partially_published"; if(states.some(x=>active.has(x))) return "in_progress"; if(states.every(x=>scheduled.has(x))) return "scheduled"; return "draft" }
export function isAutopostJobSourceCurrent(job:{source_package_fingerprint:string}, current:{source_package_fingerprint:string}){ return job.source_package_fingerprint === current.source_package_fingerprint }
