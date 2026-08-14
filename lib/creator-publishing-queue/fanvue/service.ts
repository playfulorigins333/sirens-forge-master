import "server-only"
import { getSupabaseAdmin } from "../../supabaseAdmin"
import { runFanvuePublicationWorker, type ClaimedFanvueJob, type FanvueWorkerStore } from "./workerCore"
import type { PreparedFanvueExecutionEnvelope } from "./executor"

type Admin = ReturnType<typeof getSupabaseAdmin>
type Hydrator = (facts: { job: any; destination: any; oauth: any; contentPackage: any; media: any[] }) => Promise<PreparedFanvueExecutionEnvelope>
export function createFanvueCpqStore(admin: Admin, hydrate: Hydrator): FanvueWorkerStore {
  return {
    async claimDue(limit, leaseMinutes) {
      const { data, error } = await admin.rpc("creator_publishing_claim_scheduled_fanvue_jobs", { p_limit: limit, p_lease_minutes: leaseMinutes }); if (error) throw new Error("FANVUE_CPQ_CLAIM_FAILED")
      const claimed: ClaimedFanvueJob[] = []
      for (const claim of data ?? []) {
        const { data: job } = await admin.from("creator_publishing_platform_jobs").select("*").eq("id", claim.job_id).eq("target_platform", "fanvue").single()
        if (!job || job.job_state !== "publishing_direct" || job.lease_token !== claim.lease_token) throw new Error("FANVUE_CPQ_JOB_INVALID")
        const [{ data: destination }, { data: oauth }, { data: contentPackage }, { data: media }] = await Promise.all([
          admin.from("creator_platform_accounts").select("*").eq("id", job.platform_account_id).eq("creator_id", job.creator_id).eq("platform", "fanvue").single(),
          admin.from("autopost_accounts").select("*").eq("id", job.oauth_account_id).eq("user_id", job.creator_id).eq("platform", "fanvue").single(),
          admin.from("creator_publishing_content_packages").select("*").eq("id", job.content_package_id).eq("creator_id", job.creator_id).eq("platform_account_id", job.platform_account_id).eq("target_platform", "fanvue").single(),
          admin.from("creator_publishing_media_assets").select("*").eq("content_package_id", job.content_package_id).eq("creator_id", job.creator_id),
        ])
        if (!destination || destination.oauth_account_id !== job.oauth_account_id || !oauth || oauth.connection_status !== "CONNECTED" || !contentPackage || contentPackage.creator_approval_status !== "approved" || contentPackage.compliance_status !== "passed") throw new Error("FANVUE_CPQ_REQUIREMENTS_INVALID")
        const envelope = await hydrate({ job, destination, oauth, contentPackage, media: media ?? [] })
        claimed.push({ jobId: job.id, attemptId: claim.attempt_id, leaseToken: claim.lease_token, attemptOrdinal: claim.attempt_ordinal, envelope })
      }
      return claimed
    },
    async entitlementActive(creatorId) { const { data } = await admin.from("profiles").select("id").eq("user_id", creatorId).single(); if (!data) return false; const { data: subscriptions } = await admin.from("user_subscriptions").select("id").eq("user_id", data.id).in("status", ["active", "trialing"]).limit(1); return Boolean(subscriptions?.length) },
    async executionRequirementsValid(jobId, creatorId) { const { data } = await admin.rpc("creator_publishing_job_source_is_current", { p_job_id: jobId }); if (data !== true) return false; const { data: consent } = await admin.from("creator_publishing_ai_twin_consents").select("id").eq("creator_id", creatorId).eq("status", "active").limit(1); return Boolean(consent?.length) },
    async markCreateDispatched(attemptId, leaseToken) { const { data, error } = await admin.rpc("creator_publishing_mark_fanvue_create_dispatched", { p_attempt_id: attemptId, p_lease_token: leaseToken }); return !error && data === true },
    async finish(input) { const r=input.result; const { data,error }=await admin.rpc("creator_publishing_finish_fanvue_attempt",{p_attempt_id:input.attemptId,p_lease_token:input.leaseToken,p_outcome:input.outcome,p_upload:r.upload_attempted,p_refresh:r.token_refresh_attempted,p_safe_code:r.safe_code,p_status:r.create_status_class,p_proof:r.provider_post_uuid,p_next:input.nextAttemptAt}); return !error&&data===true },
  }
}
export function runDormantFanvueCpqWorker(input:{enabled:boolean;batchSize:number;hydrate:Hydrator}){return runFanvuePublicationWorker({enabled:input.enabled,batchSize:input.batchSize,store:createFanvueCpqStore(getSupabaseAdmin(),input.hydrate)})}
