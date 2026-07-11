import type { JobState, PlanStatus } from "./types"
export const AUTOPOST_TERMINAL_SUCCESS_STATES = ["published_direct", "confirmed_posted_manual", "exported"] as const satisfies readonly JobState[]
export const AUTOPOST_TERMINAL_FAILURE_STATES = ["direct_publish_failed", "failed_manual_upload", "skipped", "blocked", "platform_rejected", "archived"] as const satisfies readonly JobState[]
export const AUTOPOST_SCHEDULED_STATES = ["scheduled_internally", "scheduled_on_platform", "retry_scheduled"] as const satisfies readonly JobState[]
export const AUTOPOST_ACTIVE_STATES = ["ready_to_publish", "direct_publish_queued", "publishing_direct", "awaiting_operator", "due_now", "claimed", "awaiting_post_confirmation"] as const satisfies readonly JobState[]
export const AUTOPOST_DRAFTISH_STATES = ["draft", "package_ready", "ready_for_export", "authentication_required", "needs_fix"] as const satisfies readonly JobState[]
const success = new Set<JobState>(AUTOPOST_TERMINAL_SUCCESS_STATES)
const failure = new Set<JobState>(AUTOPOST_TERMINAL_FAILURE_STATES)
const scheduled = new Set<JobState>(AUTOPOST_SCHEDULED_STATES)
const active = new Set<JobState>(AUTOPOST_ACTIVE_STATES)
export function isTerminalAutopostJobState(state: JobState){ return success.has(state) || failure.has(state) }
export function isActiveConflictAutopostJobState(state: JobState){ return !isTerminalAutopostJobState(state) }
export function aggregateAutopostPlanStatus(states:JobState[], currentStatus:PlanStatus="draft"):PlanStatus{ if(currentStatus==="cancelled") return "cancelled"; if(states.length===0) return "draft"; const s=states.filter(x=>success.has(x)).length; const f=states.filter(x=>failure.has(x)).length; const sch=states.filter(x=>scheduled.has(x)).length; const a=states.filter(x=>active.has(x)).length; const d=states.filter(x=>AUTOPOST_DRAFTISH_STATES.includes(x as any)).length; if(s===states.length) return "completed"; if(s+f===states.length && f>0) return "completed_with_failures"; if(s>0) return "partially_published"; if(a>0) return "in_progress"; if(sch===states.length) return "scheduled"; if(sch>0) return "in_progress"; if(f>0) return "in_progress"; if(d===states.length) return "draft"; return "in_progress" }
export function isAutopostJobSourceCurrent(job:{source_package_fingerprint:string}, current:{source_package_fingerprint:string}){ return job.source_package_fingerprint === current.source_package_fingerprint }
