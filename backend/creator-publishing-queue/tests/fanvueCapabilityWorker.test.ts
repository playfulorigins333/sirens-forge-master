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
let claimedLimit=0; const summary=await runFanvuePublicationWorker({enabled:false,batchSize:999,store:{claimDue:async limit=>{claimedLimit=limit;return[]},prepareClaim:async()=>({ok:false as const,outcome:"permanent" as const,safeCode:"NO"}),markCreateDispatched:async()=>true,finish:async()=>true}})
assert.equal(summary.claimed,0); assert.equal(claimedLimit,0)
console.log('Fanvue capability and worker state-machine tests passed')
const claims:any[]=[{jobId:'bad',attemptId:'a1',leaseToken:'l1',attemptOrdinal:1},{jobId:'good',attemptId:'a2',leaseToken:'l2',attemptOrdinal:1}];const finished:any[]=[];let markers=0,creates=0
const goodEnvelope:any={creatorId:'creator',destination:{id:'dest',creator_id:'creator',platform:'fanvue',oauth_account_id:'oauth'},oauthAccount:{id:'oauth',user_id:'creator',platform:'fanvue',connection_status:'CONNECTED',encrypted_access_token:'cipher',encrypted_refresh_token:'refresh',token_expires_at:'2099-01-01T00:00:00.000Z',scopes:['write:post']},approvedContent:{platform:'fanvue',content_type:'text',text:'approved'},provider:{apiBaseUrl:'https://mock.invalid',apiVersion:'1',decryptAccessToken:()=> 'token',fanvueFetch:async()=>{creates++;return{ok:true,status:200,json:async()=>({uuid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})}},fetchIdentity:async()=>{throw new Error('unused')},signedPartUploader:async()=>({ok:true,status:200,json:async()=>({})})}}
const batch=await runFanvuePublicationWorker({enabled:true,batchSize:2,store:{claimDue:async()=>claims,prepareClaim:async c=>c.jobId==='bad'?{ok:false,outcome:'permanent',safeCode:'FANVUE_CPQ_CONSENT_INVALID'}:{ok:true,envelope:goodEnvelope},markCreateDispatched:async()=>{markers++;return true},finish:async i=>{finished.push(i);return true}}});assert.equal(batch.claimed,2);assert.equal(batch.failed,1);assert.equal(batch.succeeded,1);assert.equal(finished.length,2);assert.equal(markers,1);assert.equal(creates,1)
console.log('Fanvue per-claim isolation tests passed')
