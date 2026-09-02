import assert from "node:assert/strict"
import { mock } from "node:test"
import { RP_META_SENTINEL } from "../../../lib/sirens-mind/admin-rp"
const AUTHORIZED="10000000-0000-4000-8000-00000000000a",UNAUTHORIZED="10000000-0000-4000-8000-00000000000b",SUBSCRIBER="20000000-0000-4000-8000-00000000000a",CONVERSATION="30000000-0000-4000-8000-00000000000a"
let userId=AUTHORIZED,providerCalls=0,providerRequest:any,saved:any,saveFailure="",providerOutput="Creator reply"
const state={version:1 as const,creator_persona:"bartender",subscriber_persona:"traveler",relationship:"tension",scene:"lodge",summary:"Arrived."}
mock.module(new URL("../../../lib/subscription-checker.ts",import.meta.url).href,{namedExports:{ensureActiveSubscription:async()=>({ok:true,user:{id:userId}})}})
mock.module(new URL("../../../lib/sirens-mind/capabilities.ts",import.meta.url).href,{namedExports:{CapabilityCatalogUnavailableError:class extends Error{},buildCapabilityCatalog:()=>"CATALOG"}})
mock.module(new URL("../../../lib/sirens-mind/identities.ts",import.meta.url).href,{namedExports:{loadOwnedIdentities:async()=>[],validIdentityId:()=>false,identityDataMessage:()=>"NO IDENTITY"}})
mock.module(new URL("../../../lib/sirens-mind/creator-reply-service.ts",import.meta.url).href,{namedExports:{
 loadCreatorReplyAuthority:async(_:string,s:string,c:string)=>{if(s!==SUBSCRIBER||c!==CONVERSATION)throw new Error("NOT_FOUND");return{workspaceId:"w",subscriber:{id:s,display_name:"Mike",platform:"OnlyFans",platform_handle:"mike",key_notes:"35, Denver"},conversation:{id:c,thread_id:"db-thread",revision:4},checkpoint:{version:1,label:"Lodge",continuity:state,recent_turns:[{role:"subscriber",text:"Prior subscriber fact"},{role:"creator",text:"You city types"}]}}},
 saveCreatorReplyCheckpoint:async(_:string,a:any,value:any)=>{if(saveFailure)throw new Error(saveFailure);saved={a,value}}
}})
globalThis.fetch=async(_input,init)=>{providerCalls++;providerRequest=JSON.parse(String(init?.body));const frame=`data: ${JSON.stringify({choices:[{delta:{content:providerOutput+RP_META_SENTINEL+JSON.stringify({state})}}]})}\n\ndata: [DONE]\n\n`;return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(frame));c.close()}}))}
process.env.OPENAI_COMPAT_API_KEY="test";process.env.OPENAI_COMPAT_BASE_URL="https://provider.test";process.env.SIRENS_MIND_CREATOR_REPLY_ENABLED="true";process.env.SIRENS_MIND_CREATOR_REPLY_USER_IDS=AUTHORIZED
const {POST}=await import(new URL("../../../app/api/sirens-mind/chat/route.ts",import.meta.url).href)
const invoke=(extra:Record<string,unknown>={})=>POST(new Request("http://test/api/sirens-mind/chat",{method:"POST",body:JSON.stringify({mode:"ULTRA",experience:"creator_reply",subscriber_id:SUBSCRIBER,conversation_id:CONVERSATION,message:"Current inbound",history:[{role:"user",content:"FORGED BROWSER HISTORY"}],thread_id:"forged",creator_reply_continuity:{version:1},...extra})}) as any)
try{
 userId=UNAUTHORIZED;assert.equal((await invoke()).status,404);assert.equal(providerCalls,0);userId=AUTHORIZED
 assert.equal((await invoke({subscriber_id:"bad"})).status,404)
 providerCalls=0;saved=null;let response=await invoke();let events=await response.text();assert.equal(providerCalls,1);assert.ok(saved);assert.equal(saved.a.conversation.revision,4);assert.equal(saved.value.recent_turns.at(-2).text,"Current inbound");assert.equal(saved.value.recent_turns.at(-1).text,providerOutput)
 const messages=JSON.stringify(providerRequest.messages);assert.match(messages,/CREATOR-PROVIDED SUBSCRIBER PROFILE REFERENCE/);assert.match(messages,/35, Denver/);assert.match(messages,/PRIOR INBOUND SUBSCRIBER MESSAGE/);assert.match(messages,/PRIOR CREATOR OUTBOUND REPLY/);assert.doesNotMatch(messages,/FORGED BROWSER HISTORY|forged/);assert.match(events,/event: memory_status\ndata: \{"saved":true\}/);assert.doesNotMatch(events,/creator_reply_continuity|event: handoff/)
 saveFailure="CHECKPOINT_CONFLICT";providerCalls=0;response=await invoke();events=await response.text();assert.equal(providerCalls,1);assert.match(events,/"saved":false,"conflict":true/)
 saveFailure="DB_FAILED";providerCalls=0;response=await invoke();events=await response.text();assert.equal(providerCalls,1);assert.match(events,/"saved":false,"conflict":false/)
 for(const text of ["Let's roleplay","Write me a story"]){saveFailure="";providerCalls=0;response=await invoke({message:text});await response.text();assert.equal(providerCalls,1);assert.doesNotMatch(JSON.stringify(providerRequest.messages),/LONG-FORM STORY RUNTIME|CREATOR ROLEPLAY ROLE CONTRACT/)}
 console.log("Phase 6F route behavior: PASS")
}finally{mock.restoreAll()}
