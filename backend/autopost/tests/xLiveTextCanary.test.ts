import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { register } from "node:module"
register(`data:text/javascript,export async function resolve(s,c,n){return s==='server-only'?{url:'data:text/javascript,export default {}',shortCircuit:true}:n(s,c)}`)

const c = await import("../../../lib/autopost/xLiveTextCanary.ts")
const x = await import("../../../lib/autopost/xAdapter.ts")
const availability = await import("../../../lib/autopost/platformAvailability.ts")

const account:any={connection_status:"CONNECTED",provider_account_id:"protected-provider",provider_username:"The_beard0302",last_error:null,encrypted_access_token:"encrypted-access",encrypted_refresh_token:"encrypted-refresh",token_expires_at:"2035-01-01T00:00:00.000Z",token_key_version:7,metadata:{provider:"x",identity_fetched:true}}
type F=typeof fetch
function fixture(overrides:Record<string,unknown>={}){
  let fetches=0,decrypts:string[]=[],keyCalls=0,timeoutCalls:number[]=[];let seen:any
  const rawFetch=(overrides.fetchImpl as F|undefined)??(async(u:any,i:any)=>{seen=[u,i];return new Response(JSON.stringify({data:{id:" post-123 "}}),{status:201})}) as F
  const rest={...overrides};for(const k of ["fetchImpl","decryptToken","getTokenKeyVersion","createTimeoutSignal"])delete rest[k]
  const deps:any={loadAccount:async()=>structuredClone(account),now:()=>new Date("2030-01-01T00:00:00Z"),getApiBaseUrl:()=>"https://api.x.com",...rest,
    getTokenKeyVersion:()=>{keyCalls++;return "getTokenKeyVersion" in overrides?(overrides.getTokenKeyVersion as any)():7},
    decryptToken:(v:string)=>{decrypts.push(v);return "decryptToken" in overrides?(overrides.decryptToken as any)(v):"fake-access-token"},
    createTimeoutSignal:(n:number)=>{timeoutCalls.push(n);return (overrides.createTimeoutSignal as any)?.(n)??new AbortController().signal},
    fetchImpl:(async(...a:Parameters<F>)=>{fetches++;seen=a;return rawFetch(...a)}) as F}
  return{deps,fetches:()=>fetches,decrypts,keyCalls:()=>keyCalls,timeoutCalls,seen:()=>seen}
}
function checkFlags(out:any,provider=false,verified=false,uncertain=false){for(const [k,v] of Object.entries({database_write_attempted:false,refresh_attempted:false,retry_attempted:false,runner_invoked:false,scheduler_action_attempted:false,cron_action_attempted:false,public_enablement_attempted:false,fanvue_account_queried:false,fanvue_account_mutated:false,provider_request_attempted:provider,post_attempted:provider,post_verified:verified,outcome_uncertain:uncertain}))assert.equal(out[k],v,k)}

// Exact X-only account read and absence of mutation capability.
{
 const ops:any[]=[];const builder:any={select(v:string){ops.push(["select",v]);return this},eq(k:string,v:string){ops.push(["eq",k,v]);return this},maybeSingle(){ops.push(["maybeSingle"]);return Promise.resolve({data:account,error:null})},update(){throw Error("mutation")},upsert(){throw Error("mutation")},insert(){throw Error("mutation")},delete(){throw Error("mutation")}}
 const db:any={from(t:string){ops.push(["from",t]);return builder},rpc(){throw Error("mutation")}}
 assert.deepEqual(await c.createXLiveTextCanaryAccountLoader(db)("user"),account)
 assert.deepEqual(ops,[["from","autopost_accounts"],["select",c.X_LIVE_CANARY_ACCOUNT_SELECT],["eq","user_id","user"],["eq","platform","x"],["maybeSingle"]])
}

// Every strict stored-posture blocker terminates before key lookup, decryption, or provider contact.
const blockers:Array<[string,any]>=[["missing",null],["disconnected",{connection_status:"DISCONNECTED"}],["expired",{connection_status:"EXPIRED"}],["revoked",{connection_status:"REVOKED"}],["error",{connection_status:"ERROR"}],["unknown",{connection_status:"BOGUS"}],["provider id",{provider_account_id:" "}],["username",{provider_username:" "}],["access",{encrypted_access_token:""}],["refresh",{encrypted_refresh_token:""}],["expiry",{token_expires_at:"bad"}],["key",{token_key_version:0}],["metadata",{metadata:{provider:"other",identity_fetched:true}}],["identity",{metadata:{provider:"x",identity_fetched:false}}],["last error",{last_error:"private"}]]
for(const [,patch] of blockers){const row=patch===null?null:{...account,...patch};const f=fixture({loadAccount:async()=>row});const out=await c.runXLiveTextCanary("user",f.deps);assert.equal(out.safe_code,"X_LIVE_CANARY_ACCOUNT_NOT_READY");assert.ok(availability.getXStoredPostureBlocker(row));assert.equal(f.keyCalls(),0);assert.deepEqual(f.decrypts,[]);assert.equal(f.fetches(),0);checkFlags(out)}

// Protected username normalization and mismatch ordering.
for(const username of ["The_beard0302","  the_beard0302  ","THE_BEARD0302"]){const f=fixture({loadAccount:async()=>({...account,provider_username:username})});assert.equal((await c.runXLiveTextCanary("u",f.deps)).safe_code,"X_LIVE_CANARY_SUCCEEDED")}
for(const username of ["different","@The_beard0302"]){const f=fixture({loadAccount:async()=>({...account,provider_username:username})});const out=await c.runXLiveTextCanary("u",f.deps);assert.equal(out.safe_code,"X_LIVE_CANARY_PROTECTED_USERNAME_MISMATCH");assert.equal(f.keyCalls(),0);assert.deepEqual(f.decrypts,[]);assert.equal(f.fetches(),0)}

// Key version and strict expiry buffer.
for(const value of [undefined,"7",NaN,Infinity,7.5,0,-1]){const f=fixture({getTokenKeyVersion:()=>value});assert.equal((await c.runXLiveTextCanary("u",f.deps)).safe_code,"X_LIVE_CANARY_TOKEN_KEY_VERSION_UNAVAILABLE");assert.deepEqual(f.decrypts,[])}
{const f=fixture({getTokenKeyVersion:()=>{throw Error("private")}});assert.equal((await c.runXLiveTextCanary("u",f.deps)).safe_code,"X_LIVE_CANARY_TOKEN_KEY_VERSION_UNAVAILABLE")}
{const f=fixture({getTokenKeyVersion:()=>8});assert.equal((await c.runXLiveTextCanary("u",f.deps)).safe_code,"X_LIVE_CANARY_TOKEN_KEY_VERSION_MISMATCH");assert.deepEqual(f.decrypts,[])}
const now=Date.parse("2030-01-01T00:00:00Z")
for(const expiry of [new Date(now).toISOString(),new Date(now+59999).toISOString(),new Date(now+60000).toISOString()]){const f=fixture({loadAccount:async()=>({...account,token_expires_at:expiry})});const out=await c.runXLiveTextCanary("u",f.deps);assert.equal(out.safe_code,"X_LIVE_CANARY_TOKEN_EXPIRED_OR_EXPIRING");assert.deepEqual(f.decrypts,[]);assert.equal(f.fetches(),0);checkFlags(out)}
{const f=fixture({loadAccount:async()=>({...account,token_expires_at:new Date(now+60001).toISOString()})});assert.equal((await c.runXLiveTextCanary("u",f.deps)).safe_code,"X_LIVE_CANARY_SUCCEEDED")}

// Access-token-only decryption and sanitized failure.
{const f=fixture();await c.runXLiveTextCanary("u",f.deps);assert.deepEqual(f.decrypts,["encrypted-access"]);assert.ok(!f.decrypts.includes("encrypted-refresh"))}
for(const [decryptToken,code] of [[()=>{throw Error("secret exception")},"X_LIVE_CANARY_ACCESS_TOKEN_DECRYPT_FAILED"],[()=>null,"X_LIVE_CANARY_ACCESS_TOKEN_INVALID"],[()=>"   ","X_LIVE_CANARY_ACCESS_TOKEN_INVALID"]] as const){const f=fixture({decryptToken});const out=await c.runXLiveTextCanary("u",f.deps);assert.equal(out.safe_code,code);assert.equal(f.fetches(),0);assert.ok(!JSON.stringify(out).includes("secret"))}

// Provider endpoint is exact and rejects every configuration variation before fetch.
for(const value of ["not a url","http://api.x.com","https://other.invalid","https://api.x.com:444","https://u@api.x.com","https://u:p@api.x.com","https://api.x.com?q=1","https://api.x.com#x","https://api.x.com/wrong"]){const f=fixture({getApiBaseUrl:()=>value});assert.equal((await c.runXLiveTextCanary("u",f.deps)).safe_code,"X_LIVE_CANARY_PROVIDER_CONFIG_INVALID");assert.equal(f.fetches(),0)}
{const f=fixture({getApiBaseUrl:()=>{throw Error("private")}});assert.equal((await c.runXLiveTextCanary("u",f.deps)).safe_code,"X_LIVE_CANARY_PROVIDER_CONFIG_INVALID")}

// Exact fixed-text request, one timeout signal, one fetch, and verified success.
{
 const signal=new AbortController().signal;let captured:any
 const f=fixture({createTimeoutSignal:(n:number)=>{assert.equal(n,10000);return signal},fetchImpl:async(u:any,i:any)=>{captured=[u,i];return new Response(JSON.stringify({data:{id:"  id-1  "}}),{status:202})}})
 const out=await c.runXLiveTextCanary("u",f.deps);assert.equal(out.safe_code,"X_LIVE_CANARY_SUCCEEDED");assert.equal(out.post_id,"id-1");assert.deepEqual(f.timeoutCalls,[10000]);assert.equal(f.fetches(),1);assert.equal(String(captured[0]),"https://api.x.com/2/tweets");assert.equal(captured[1].method,"POST");assert.equal(captured[1].signal,signal);assert.deepEqual(captured[1].headers,{authorization:"Bearer fake-access-token","content-type":"application/json"});assert.equal(captured[1].body,'{"text":"Testing a new posting workflow. No action needed."}');assert.deepEqual(Object.keys(JSON.parse(captured[1].body)),["text"]);checkFlags(out,true,true,false)
}

async function provider(fetchImpl:F,code:string,uncertain:boolean){const f=fixture({fetchImpl});const out:any=await c.runXLiveTextCanary("u",f.deps);assert.equal(out.safe_code,code);assert.equal(f.fetches(),1);assert.equal("post_id" in out,false);checkFlags(out,true,false,uncertain);for(const marker of ["fake-access-token","encrypted-access","encrypted-refresh","raw-body","private failure"])assert.equal(JSON.stringify(out).includes(marker),false)}
for(const [status,code,uncertain] of [[401,"X_LIVE_CANARY_X_UNAUTHORIZED",false],[403,"X_LIVE_CANARY_X_FORBIDDEN",false],[429,"X_LIVE_CANARY_X_RATE_LIMITED",false],[400,"X_LIVE_CANARY_X_INVALID_REQUEST",false],[422,"X_LIVE_CANARY_X_INVALID_REQUEST",false],[418,"X_LIVE_CANARY_X_REJECTED",false],[500,"X_LIVE_CANARY_OUTCOME_UNKNOWN",true],[503,"X_LIVE_CANARY_OUTCOME_UNKNOWN",true],[302,"X_LIVE_CANARY_OUTCOME_UNKNOWN",true]] as const)await provider(async()=>new Response("raw-body",{status}),code,uncertain)
await provider(async()=>{throw Error("private failure")},"X_LIVE_CANARY_NETWORK_FAILURE",true)
await provider(async()=>({ok:true,status:201,json:async()=>{throw Error("raw-body")}}) as Response,"X_LIVE_CANARY_RESPONSE_INVALID",true)
for(const body of [null,"text",[],{}, {data:null},{data:{}},{data:{id:null}},{data:{id:" "}}])await provider(async()=>({ok:true,status:201,json:async()=>body}) as Response,"X_LIVE_CANARY_RESPONSE_INVALID",true)

// TimeoutError and a known aborted timeout signal are terminal without real waiting.
for(const kind of ["TimeoutError","AbortError"]){const controller=new AbortController();controller.abort();const f=fixture({createTimeoutSignal:()=>controller.signal,fetchImpl:async()=>{throw Object.assign(new Error("private failure"),{name:kind})}});const out:any=await c.runXLiveTextCanary("u",f.deps);assert.equal(out.safe_code,"X_LIVE_CANARY_TIMEOUT");assert.deepEqual(f.timeoutCalls,[10000]);assert.equal(f.fetches(),1);assert.equal("post_id" in out,false);checkFlags(out,true,false,true)}

// Request gates precede body inspection/account construction; bounded zero-byte streams behave exactly.
function request(body:ReadableStream<Uint8Array>|null,header=c.X_LIVE_CANARY_CONFIRMATION_VALUE,url="https://local.invalid/api"):Request{return {body,headers:new Headers(header===undefined?{}:{[c.X_LIVE_CANARY_CONFIRMATION_HEADER]:header}),url} as Request}
function stream(chunks:Uint8Array[],fail=false){return new ReadableStream<Uint8Array>({pull(controller){if(fail){controller.error(Error("body private"));return}const next=chunks.shift();if(next)controller.enqueue(next);else controller.close()}})}
let loads=0;const base:any={...fixture().deps,loadAccount:async()=>{loads++;return account}}
const poison=new ReadableStream<Uint8Array>({pull(){throw Error("inspected")}})
for(const args of [{getAuthenticatedUserId:async()=>null,request:request(poison)},{getAuthenticatedUserId:async()=>" ",request:request(poison)},{getAuthenticatedUserId:async()=>"u",request:request(poison,undefined)},{getAuthenticatedUserId:async()=>"u",request:request(poison,"wrong")},{getAuthenticatedUserId:async()=>"u",request:request(poison,c.X_LIVE_CANARY_CONFIRMATION_VALUE,"https://local.invalid/api?q=1")}]){const out=await c.handleXLiveTextCanaryRequest({...base,...args});assert.ok(out.status===400||out.status===401);assert.equal(loads,0)}
for(const body of [stream([new Uint8Array([1])]),stream([new TextEncoder().encode(" ")]),stream([new TextEncoder().encode("{}")]),stream([new TextEncoder().encode("null")]),stream([],true),stream(Array.from({length:10},()=>new Uint8Array()))]){const out=await c.handleXLiveTextCanaryRequest({...base,request:request(body),getAuthenticatedUserId:async()=>"u"});assert.equal(out.body.safe_code,"X_LIVE_CANARY_PARAMETERS_NOT_ALLOWED");assert.equal(loads,0)}
const stalled=new ReadableStream<Uint8Array>({pull(){return new Promise(()=>{})}});assert.equal((await c.handleXLiveTextCanaryRequest({...base,request:request(stalled),getAuthenticatedUserId:async()=>"u"})).body.safe_code,"X_LIVE_CANARY_PARAMETERS_NOT_ALLOWED");assert.equal(loads,0)
for(const body of [null,stream([]),stream([new Uint8Array(),new Uint8Array()])]){const before=loads;const out=await c.handleXLiveTextCanaryRequest({...base,request:request(body),getAuthenticatedUserId:async()=>"u"});assert.equal(out.body.safe_code,"X_LIVE_CANARY_SUCCEEDED");assert.equal(loads,before+1)}
{const before=loads;const out=await c.handleXLiveTextCanaryRequest({...base,request:request(stream([new Uint8Array(),new Uint8Array([1])])),getAuthenticatedUserId:async()=>"u"});assert.equal(out.body.safe_code,"X_LIVE_CANARY_PARAMETERS_NOT_ALLOWED");assert.equal(loads,before)}
assert.equal(c.xLiveTextCanaryMethodNotAllowedResult().safe_code,"X_LIVE_CANARY_METHOD_NOT_ALLOWED")

// Source/product locks and normal low-level outward compatibility evidence.
const route=readFileSync("app/api/admin/autopost/x/live-text-canary/route.ts","utf8")
for(const marker of ['runtime = "nodejs"','dynamic = "force-dynamic"','private, no-store, max-age=0','status: 405','requireUserId({ request })'])assert.ok(route.includes(marker),marker)
for(const path of ["lib/autopost/xLiveTextCanary.ts", "app/api/admin/autopost/x/live-text-canary/route.ts"]){const source=readFileSync(path,"utf8");for(const bad of ["refreshXAccessToken","postXTextOnlyAutopost",".update(",".upsert(",".insert(",".delete(",".rpc(","console.log","console.error"])assert.equal(source.includes(bad),false,`${path}: ${bad}`)}
for(const path of ["app/autopost/AutopostPageClient.tsx","app/api/autopost/run/route.ts","vercel.json"]){assert.equal(readFileSync(path,"utf8").includes("/api/admin/autopost/x/live-text-canary"),false)}
assert.equal(process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED??"false","false")
assert.equal(x.X_TOKEN_EXPIRY_REFRESH_BUFFER_MS,60000);assert.equal(c.X_LIVE_CANARY_TIMEOUT_MS,10000)
console.log("X live text canary deterministic fake-only tests passed; no provider or Production action occurred.")
