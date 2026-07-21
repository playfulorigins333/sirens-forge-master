import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

function parseLocal(name, expectedDb) {
  const raw = process.env[name]
  if (!raw) throw new Error(`${name} is required`)
  const url = new URL(raw)
  if (!['127.0.0.1','localhost','::1'].includes(url.hostname)) throw new Error(`${name} must use a loopback host`)
  if (url.port !== '5432') throw new Error(`${name} must use port 5432`)
  if (url.search || url.hash) throw new Error(`${name} must not include query strings or fragments`)
  if (url.pathname !== `/${expectedDb}`) throw new Error(`${name} must target ${expectedDb}`)
  return raw
}
const adminUrl=parseLocal('DATABASE_URL','postgres')
const taskUrl=parseLocal('TASK21_VERIFIED_DESTINATION_DATABASE_URL','task21_verified_destination_ci')
function run(cmd,args,input){ const r=spawnSync(cmd,args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}); if(r.status!==0){ console.error(`Task21 integration command failed: ${cmd}`); console.error((r.stderr||r.stdout||'').split('\n').slice(-20).join('\n')); process.exit(r.status??1)} return r.stdout }
run('psql',[adminUrl,'-v','ON_ERROR_STOP=1'], 'drop database if exists task21_verified_destination_ci; create database task21_verified_destination_ci;')
const migrations=['20260710000100_creator_publishing_queue_foundation.sql','20260710000200_creator_publishing_compliance_manual_review_outcome.sql','20260710000300_creator_publishing_manual_review_workflow.sql','20260710000400_creator_publishing_creator_approval_queue.sql','20260710000500_creator_publishing_media_upload_intents.sql','20260710000600_creator_publishing_generated_media_association.sql','20260710000700_creator_publishing_platform_account_setup.sql','20260710000800_creator_publishing_package_composer.sql','20260710000900_creator_publishing_trusted_verification.sql','20260710001000_creator_publishing_ai_twin_consent.sql','20260710001100_creator_publishing_trusted_compliance_submission.sql','20260711001200_creator_publishing_autopost_orchestration.sql','20260711001300_creator_publishing_scheduler_due_state.sql','20260712001400_creator_publishing_onlyfans_operator_queue.sql','20260716001500_creator_publishing_onlyfans_manual_completion.sql','20260718001700_creator_publishing_onlyfans_history_timeline.sql','20260721001800_creator_publishing_verified_destination_guards.sql']
for(const m of migrations) run('psql',[taskUrl,'-v','ON_ERROR_STOP=1','-f',`supabase/migrations/${m}`])
run('psql',[taskUrl,'-v','ON_ERROR_STOP=1','-f','backend/creator-publishing-queue/tests/task21VerifiedDestinationPostgresIntegration.sql'])
console.log('TASK21_VERIFIED_DESTINATION_POSTGRES_INTEGRATION_PASSED')
