import type { OnlyFansHistoryEntry, OnlyFansHistoryFilter, OnlyFansHistorySort } from "./types"

export const ONLYFANS_HISTORY_FILTER_OPTIONS: ReadonlyArray<{ value:OnlyFansHistoryFilter; label:string }> = [
  { value:"all", label:"All events" },
  { value:"scheduling", label:"Scheduling" },
  { value:"operator", label:"Operator activity" },
  { value:"evidence", label:"Evidence" },
  { value:"completion", label:"Completion and rejection" },
]

export const ONLYFANS_HISTORY_SORT_OPTIONS: ReadonlyArray<{ value:OnlyFansHistorySort; label:string }> = [
  { value:"oldest", label:"Oldest first" },
  { value:"newest", label:"Newest first" },
]

function compareStableReference(left:OnlyFansHistoryEntry,right:OnlyFansHistoryEntry) {
  const leftAudit=left.auditEventId
  const rightAudit=right.auditEventId
  if (leftAudit && rightAudit) {
    const numeric=/^\d+$/
    if (numeric.test(leftAudit) && numeric.test(rightAudit)) {
      const byLength=leftAudit.length-rightAudit.length
      if (byLength) return byLength
    }
    const byAudit=leftAudit.localeCompare(rightAudit)
    if (byAudit) return byAudit
  } else if (leftAudit) return -1
  else if (rightAudit) return 1
  return left.id.localeCompare(right.id)
}

export function sortOnlyFansHistoryEntries<T extends OnlyFansHistoryEntry>(entries:ReadonlyArray<T>,sort:OnlyFansHistorySort):T[] {
  return [...entries].sort((left,right)=>{
    const byTime=left.occurredAt.localeCompare(right.occurredAt)
    if (byTime) return sort==="oldest" ? byTime : -byTime
    return compareStableReference(left,right)
  })
}

export function filterAndSortOnlyFansHistoryEntries(entries:ReadonlyArray<OnlyFansHistoryEntry>,filter:OnlyFansHistoryFilter,sort:OnlyFansHistorySort) {
  const filtered=filter==="all" ? entries : entries.filter(entry=>entry.category===filter)
  return sortOnlyFansHistoryEntries(filtered,sort)
}
