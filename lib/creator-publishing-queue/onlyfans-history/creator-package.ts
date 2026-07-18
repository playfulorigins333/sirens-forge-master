import { normalizeOnlyFansHistory } from "./core"
import type { OnlyFansCreatorPackageHistoryView, OnlyFansHistoryRows } from "./types"

export type CreatorOnlyFansPackageHistoryDeps = {
  loadPackage: (contentPackageId:string, creatorId:string) => Promise<any|null>
  loadJobs: (contentPackageId:string, creatorId:string) => Promise<any[]>
  collectJobRows: (job:any) => Promise<OnlyFansHistoryRows>
}

function compareJobsNewestFirst(left:any, right:any) {
  const byCreated=String(right?.created_at ?? "").localeCompare(String(left?.created_at ?? ""))
  return byCreated || String(right?.id ?? "").localeCompare(String(left?.id ?? ""))
}

export async function loadCreatorOnlyFansPackageHistoryCore(
  contentPackageId:string,
  creatorId:string,
  deps:CreatorOnlyFansPackageHistoryDeps,
): Promise<OnlyFansCreatorPackageHistoryView> {
  const pkg=await deps.loadPackage(contentPackageId,creatorId)
  if (!pkg || pkg.id!==contentPackageId || pkg.creator_id!==creatorId || pkg.target_platform!=="onlyfans") {
    return {ok:false,code:"not_found",message:"Publishing history is unavailable."}
  }

  const jobs=(await deps.loadJobs(pkg.id,creatorId))
    .filter(job=>job?.content_package_id===pkg.id && job?.creator_id===creatorId && job?.target_platform==="onlyfans" && job?.publishing_mode==="assisted")
    .sort(compareJobsNewestFirst)

  const attempts=[]
  for (const job of jobs) {
    const rows=await deps.collectJobRows(job)
    const history=normalizeOnlyFansHistory(rows,"creator")
    if (!history.ok) continue
    attempts.push({
      platformJobId:job.id,
      jobState:job.job_state,
      createdAt:job.created_at,
      taskLinkState:rows.task?.id ? "exact" as const : "limited" as const,
      history,
    })
  }

  return {ok:true,attempts}
}
