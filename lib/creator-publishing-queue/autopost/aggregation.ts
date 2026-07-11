import type { JobState, PlanStatus } from "./types"
const success=new Set<JobState>(["published_direct","confirmed_posted_manual","exported"])
const failure=new Set<JobState>(["direct_publish_failed","failed_manual_upload","skipped","blocked","platform_rejected"])
const scheduled=new Set<JobState>(["scheduled_internally","scheduled_on_platform","retry_scheduled"])
const active=new Set<JobState>(["publishing_direct","direct_publish_queued","awaiting_operator","due_now","claimed","awaiting_post_confirmation","ready_to_publish"])
export function aggregateAutopostPlanStatus(states:JobState[], currentStatus:PlanStatus="draft"):PlanStatus{ if(currentStatus==="cancelled") return "cancelled"; if(states.length===0) return "draft"; const s=states.filter(x=>success.has(x)).length; const f=states.filter(x=>failure.has(x)).length; if(s===states.length) return "completed"; if(s>0&&f>0&&s+f===states.length) return "completed_with_failures"; if(s>0) return "partially_published"; if(states.some(x=>active.has(x))) return "in_progress"; if(states.every(x=>scheduled.has(x))) return "scheduled"; return "draft" }
export function isAutopostJobSourceCurrent(job:{source_package_updated_at:string}, pkg:{updated_at:string}){ return job.source_package_updated_at === pkg.updated_at }
