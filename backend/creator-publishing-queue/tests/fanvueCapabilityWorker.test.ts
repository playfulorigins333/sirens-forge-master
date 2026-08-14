import assert from "node:assert/strict"
import { classifyFanvuePublicationCapability } from "../../../lib/creator-publishing-queue/fanvue/capability"
import { classifyFanvueExecutionOutcome, nextFanvueAttemptAt, runFanvuePublicationWorker } from "../../../lib/creator-publishing-queue/fanvue/workerCore"
import { fanvueProviderBaseResult } from "../../../lib/autopost/fanvueProviderExecutorCore"

const account:any={user_id:'11111111-1111-4111-8111-111111111111',platform:'fanvue',connection_status:'CONNECTED',encrypted_access_token:'cipher',encrypted_refresh_token:'refresh',scopes:['write:post','read:media','write:media','write:creator']}
const ready=classifyFanvuePublicationCapability(account,account.user_id)
assert.equal(ready.textReady,true); assert.equal(ready.mediaReady,true); assert.equal(ready.refreshCapable,true)
for(const [scope,code] of [['write:post','FANVUE_CAPABILITY_WRITE_POST_MISSING'],['read:media','FANVUE_CAPABILITY_READ_MEDIA_MISSING'],['write:media','FANVUE_CAPABILITY_WRITE_MEDIA_MISSING'],['write:creator','FANVUE_CAPABILITY_WRITE_CREATOR_MISSING']] as const){const result=classifyFanvuePublicationCapability({...account,scopes:account.scopes.filter((x:string)=>x!==scope)},account.user_id); assert.equal(result.mediaReady,false); assert.ok(result.missingMedia.includes(code)); if(scope==='write:post')assert.equal(result.textReady,false)}
assert.equal(classifyFanvuePublicationCapability({...account,connection_status:'DISCONNECTED'},account.user_id).connected,false)
assert.equal(classifyFanvueExecutionOutcome(fanvueProviderBaseResult({create_attempted:true,safe_code:'NETWORK_LOST'})),'uncertain')
assert.equal(classifyFanvueExecutionOutcome(fanvueProviderBaseResult({safe_code:'FANVUE_REFRESH_TOKEN_MISSING'})),'reconnect_required')
assert.equal(nextFanvueAttemptAt(1,new Date(0)),new Date(60_000).toISOString()); assert.equal(nextFanvueAttemptAt(2,new Date(0)),new Date(120_000).toISOString()); assert.equal(nextFanvueAttemptAt(3,new Date(0)),null)
let claimedLimit=0; const summary=await runFanvuePublicationWorker({enabled:false,batchSize:999,store:{claimDue:async limit=>{claimedLimit=limit;return[]},entitlementActive:async()=>true,executionRequirementsValid:async()=>true,finish:async()=>true}})
assert.equal(summary.claimed,0); assert.equal(claimedLimit,0)
console.log('Fanvue capability and worker state-machine tests passed')
