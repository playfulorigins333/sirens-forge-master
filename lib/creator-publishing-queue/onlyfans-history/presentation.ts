export const ONLYFANS_HISTORY_ACTIONS: Record<string,{label:string;creator:string;operator:string}> = {
  creator_publishing_job_scheduled:{label:"Scheduled",creator:"Your OnlyFans publication was scheduled inside Sirens Forge.",operator:"OnlyFans assisted job was scheduled."},
  creator_publishing_job_rescheduled:{label:"Rescheduled",creator:"The scheduled publication time changed.",operator:"OnlyFans assisted job was rescheduled."},
  creator_publishing_job_schedule_cancelled:{label:"Schedule cancelled",creator:"The scheduled publication was cancelled.",operator:"OnlyFans assisted job schedule was cancelled."},
  operator_onlyfans_task_claimed:{label:"Operator activity",creator:"An authorized operator started handling this publication.",operator:"Task was claimed by an authorized operator."},
  operator_onlyfans_task_released:{label:"Operator released task",creator:"Operator handling ended before completion.",operator:"Task claim was released."},
  operator_onlyfans_expired_claim_recovered:{label:"Expired operator claim recovered",creator:"An expired operator hold was cleared.",operator:"Expired claim recovery cleared stale ownership."},
  operator_onlyfans_preparation_started:{label:"Preparation started",creator:"Manual handoff preparation started.",operator:"Operator marked preparation started."},
  operator_onlyfans_package_prepared:{label:"Package prepared",creator:"The manual publishing package was prepared.",operator:"Operator marked package prepared."},
  operator_onlyfans_handoff_ready:{label:"Ready for manual handoff",creator:"The publication was ready for manual OnlyFans posting.",operator:"Operator marked handoff ready."},
  operator_onlyfans_manual_completion:{label:"Manual publication confirmed",creator:"Manual OnlyFans posting was confirmed.",operator:"Queue task/platform job moved to confirmed manual completion."},
  operator_onlyfans_manual_completion_proof_recorded:{label:"Completion proof recorded",creator:"Verified proof was recorded for the manual OnlyFans completion.",operator:"Task 20 completion proof audit event was recorded."},
  operator_onlyfans_manual_completion_rejected:{label:"Completion rejected",creator:"The trusted database rejected the completion attempt.",operator:"Audited finite database rejection for manual completion."},
}
export const rejectionWording: Record<string,{creator:string;operator:string}> = {
  current_claim_required:{creator:"Completion could not be confirmed because the operator hold was no longer current.",operator:"current_claim_required"},
  work_not_completable:{creator:"Completion could not be confirmed because the work was no longer eligible.",operator:"work_not_completable"},
  account_not_verified:{creator:"Completion could not be confirmed because the OnlyFans account was not verified.",operator:"account_not_verified"},
  package_not_approved:{creator:"Completion could not be confirmed because package approval was incomplete.",operator:"package_not_approved"},
  capability_unavailable:{creator:"Completion could not be confirmed because assisted OnlyFans publishing was unavailable.",operator:"capability_unavailable"},
  source_changed:{creator:"Completion could not be confirmed because source package data changed.",operator:"source_changed"},
  evidence_mismatch:{creator:"Completion could not be confirmed because proof evidence did not match the verified upload.",operator:"evidence_mismatch"},
  url_or_reason_required:{creator:"Completion could not be confirmed because a final URL or approved no-URL reason was required.",operator:"url_or_reason_required"},
  idempotency_conflict:{creator:"Completion could not be confirmed because the retry key was reused for different completion details.",operator:"idempotency_conflict"},
}
export function actionCopy(action:string,audience:"creator"|"operator"){ const m=ONLYFANS_HISTORY_ACTIONS[action]; return m ?? {label:action.replaceAll("_"," "), creator:"A publishing lifecycle event was recorded.", operator:`Audit action: ${action}`}; }
export function evidenceStatusLabel(status:string){ return ({pending:"Evidence upload reserved",verified:"Evidence verified",invalidated:"Evidence superseded",consumed:"Evidence consumed",failed:"Evidence failed",expired:"Evidence expired"} as Record<string,string>)[status] ?? "Evidence state recorded" }
export function noUrlReasonLabel(reason:string){ return ({platform_did_not_expose_stable_url:"OnlyFans did not expose a stable post URL.",post_completed_without_shareable_url:"The post was completed without a shareable URL.",account_owner_declined_url_capture:"The account owner declined URL capture."} as Record<string,string>)[reason] ?? "Approved no-URL reason recorded." }
