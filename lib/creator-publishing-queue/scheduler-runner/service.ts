import { getSupabaseAdmin } from "../../supabaseAdmin"
import { CREATOR_PUBLISHING_SCHEDULER_BUILD_ENABLED, runCreatorPublishingSchedulerCore } from "./serviceCore"

export { CREATOR_PUBLISHING_SCHEDULER_BUILD_ENABLED }

export function runCreatorPublishingScheduler(headers: Headers) {
  return runCreatorPublishingSchedulerCore({
    headers,
    configuredSecret: process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET,
    buildEnabled: CREATOR_PUBLISHING_SCHEDULER_BUILD_ENABLED,
    environmentEnabled: process.env.CREATOR_PUBLISHING_SCHEDULER_ENABLED,
    getAdminClient: () => getSupabaseAdmin() as unknown as import("./serviceCore").SchedulerAdminClient,
  })
}
