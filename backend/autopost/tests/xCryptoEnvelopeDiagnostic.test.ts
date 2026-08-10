import assert from "node:assert/strict"
import { createCipheriv, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { register } from "node:module"
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s,c,n){return s==='server-only'?{url:'data:text/javascript,export%20default%20{}',shortCircuit:true}:n(s,c)}`)}`)

const d = await import("../../../lib/autopost/xCryptoEnvelopeDiagnostic.ts")
const availability = await import("../../../lib/autopost/platformAvailability.ts")
const registry = await import("../../../lib/autopost/platformRegistry.ts")
const { X_CRYPTO_DIAGNOSTIC_CONFIRMATION_HEADER: HEADER, X_CRYPTO_DIAGNOSTIC_CONFIRMATION_VALUE: CONFIRM,
  createXCryptoDiagnosticAccountLoader, handleXCryptoEnvelopeDiagnosticRequest, runXCryptoEnvelopeDiagnostic,
  xCryptoEnvelopeDiagnosticMethodNotAllowedResult } = d

const key = Buffer.alloc(32, 7), keyText = key.toString("base64"), markerToken = "fake-token-marker"
function envelope(plaintext=markerToken, encryptionKey=key, padded=false) {
  const iv=Buffer.alloc(12,3), cipher=createCipheriv("aes-256-gcm",encryptionKey,iv)
  const ciphertext=Buffer.concat([cipher.update(plaintext,"utf8"),cipher.final()]), tag=cipher.getAuthTag()
  const enc=(b:Buffer)=>padded?b.toString("base64url").replace(/=+$/,"")+"=".repeat((4-b.toString("base64url").replace(/=+$/,"").length%4)%4):b.toString("base64url").replace(/=+$/,"")
  return `v1:${enc(iv)}:${enc(tag)}:${enc(ciphertext)}`
}
const account={connection_status:"CONNECTED",encrypted_access_token:envelope(),token_key_version:4}
function fixture(overrides:Record<string,unknown>={}) { let reads=0,decrypts=0
  const supplied=overrides.decryptAuthenticated as ((...args:any[])=>Buffer)|undefined
  return { reads:()=>reads,decrypts:()=>decrypts,deps:{loadAccount:async()=>{reads++;return structuredClone(account)},getTokenKeyVersion:()=>4,getEncryptionKey:()=>keyText,...overrides,
    ...(supplied?{decryptAuthenticated:(...args:any[])=>{decrypts++;return supplied(...args)}}:{})} as any }
}
function code(out:any, expected:string){assert.equal(out.safe_code,expected);assert.equal(out.ok,expected==="X_CRYPTO_DIAGNOSTIC_DECRYPTION_SUCCEEDED");for(const k of ["provider_request_attempted","database_write_attempted","oauth_attempted","refresh_attempted","retry_attempted","reconnect_attempted","disconnect_attempted","post_attempted","fanvue_account_queried","fanvue_account_mutated"])assert.equal(out[k],false,k);assert.equal(out.read_only,true);return out}
async function classify(patch:Record<string,unknown>={},deps:Record<string,unknown>={}) {const x=fixture({...deps,loadAccount:async()=>({...structuredClone(account),...patch})});return runXCryptoEnvelopeDiagnostic("session-user",x.deps)}

// Exact read-only account query boundary.
{const ops:unknown[]=[];const builder:any={select(v:string){ops.push(["select",v]);return this},eq(k:string,v:string){ops.push(["eq",k,v]);return this},async maybeSingle(){ops.push(["maybeSingle"]);return{data:account,error:null}}};const client:any={from(t:string){ops.push(["from",t]);return builder}};assert.deepEqual(await createXCryptoDiagnosticAccountLoader(client)("session-user"),account);assert.deepEqual(ops,[["from","autopost_accounts"],["select","connection_status, encrypted_access_token, token_key_version"],["eq","user_id","session-user"],["eq","platform","x"],["maybeSingle"]])}

// Request checks precede lazy privileged access; GET is inert.
{const request=(url="https://local.invalid/api",header?:string)=>new Request(url,{method:"POST",headers:header?{[HEADER]:header}:{}});for(const auth of [async()=>{throw new Error("fake-auth-error")},async()=>" "]){const x=fixture();code((await handleXCryptoEnvelopeDiagnosticRequest({...x.deps,request:request("https://local.invalid/api",CONFIRM),getAuthenticatedUserId:auth})).body,"X_CRYPTO_DIAGNOSTIC_UNAUTHENTICATED");assert.equal(x.reads(),0)}for(const [req,expected] of [[request(),"X_CRYPTO_DIAGNOSTIC_CONFIRMATION_REQUIRED"],[request("https://local.invalid/api","wrong"),"X_CRYPTO_DIAGNOSTIC_CONFIRMATION_REQUIRED"],[request("https://local.invalid/api?q=1",CONFIRM),"X_CRYPTO_DIAGNOSTIC_PARAMETERS_NOT_ALLOWED"]] as const){const x=fixture();code((await handleXCryptoEnvelopeDiagnosticRequest({...x.deps,request:req,getAuthenticatedUserId:async()=>"u"})).body,expected);assert.equal(x.reads(),0)}code(xCryptoEnvelopeDiagnosticMethodNotAllowedResult(),"X_CRYPTO_DIAGNOSTIC_METHOD_NOT_ALLOWED")}

for(const row of [null,{...account,connection_status:"ERROR"}])code(await runXCryptoEnvelopeDiagnostic("u",fixture({loadAccount:async()=>row}).deps),"X_CRYPTO_DIAGNOSTIC_ACCOUNT_NOT_READY")
for(const value of [undefined,null,"","   "])code(await classify({encrypted_access_token:value}),"X_CRYPTO_DIAGNOSTIC_ACCOUNT_NOT_READY")
code(await runXCryptoEnvelopeDiagnostic("u",fixture({loadAccount:async()=>{throw new Error("fake-db-error")}}).deps),"X_CRYPTO_DIAGNOSTIC_ACCOUNT_LOOKUP_FAILED")

// Key versions and standard Base64 validation.
for(const value of [undefined,null,0,-1,1.2,Infinity,"4"])code(await classify({}, {getTokenKeyVersion:()=>value}),"X_CRYPTO_DIAGNOSTIC_TOKEN_KEY_VERSION_INVALID")
for(const value of [undefined,null,0,-1,1.2,Infinity,"4"])code(await classify({token_key_version:value}),"X_CRYPTO_DIAGNOSTIC_TOKEN_KEY_VERSION_INVALID")
code(await classify({token_key_version:5}),"X_CRYPTO_DIAGNOSTIC_TOKEN_KEY_VERSION_MISMATCH")
for(const value of [undefined,"","  "])code(await classify({}, {getEncryptionKey:()=>value}),"X_CRYPTO_DIAGNOSTIC_KEY_NOT_CONFIGURED")
for(const value of ["!bad","AA=A","A===","AAAA=","A","__8="])code(await classify({}, {getEncryptionKey:()=>value}),"X_CRYPTO_DIAGNOSTIC_KEY_ENCODING_INVALID")
for(const size of [31,33])code(await classify({}, {getEncryptionKey:()=>Buffer.alloc(size).toString("base64")}),"X_CRYPTO_DIAGNOSTIC_KEY_LENGTH_INVALID")
code(await classify({}, {getEncryptionKey:()=>keyText}),"X_CRYPTO_DIAGNOSTIC_DECRYPTION_SUCCEEDED")
code(await classify({}, {getEncryptionKey:()=>keyText.replace(/=+$/,"")}),"X_CRYPTO_DIAGNOSTIC_DECRYPTION_SUCCEEDED")

// Envelope, IV, authentication tag, and ciphertext structure, including padding equivalence.
code(await classify({encrypted_access_token:123}),"X_CRYPTO_DIAGNOSTIC_ENVELOPE_MALFORMED")
code(await classify({encrypted_access_token:"x".repeat(16_385)}),"X_CRYPTO_DIAGNOSTIC_ENVELOPE_MALFORMED")
for(const value of ["", "v1:a:b", "v1:a:b:c:d", ":a:b:c"])if(value)code(await classify({encrypted_access_token:value}),"X_CRYPTO_DIAGNOSTIC_ENVELOPE_MALFORMED")
code(await classify({encrypted_access_token:envelope().replace(/^v1:/,"v2:")}),"X_CRYPTO_DIAGNOSTIC_ENVELOPE_VERSION_UNSUPPORTED")
const parts=envelope().split(":")
for(const iv of ["","!",parts[1]+"=",Buffer.alloc(11).toString("base64url")])code(await classify({encrypted_access_token:["v1",iv,parts[2],parts[3]].join(":")}),"X_CRYPTO_DIAGNOSTIC_IV_INVALID")
for(const tag of ["","!",parts[2]+"=",Buffer.alloc(15).toString("base64url")])code(await classify({encrypted_access_token:["v1",parts[1],tag,parts[3]].join(":")}),"X_CRYPTO_DIAGNOSTIC_AUTH_TAG_INVALID")
for(const ciphertext of ["","!",parts[3]+"==","===="])code(await classify({encrypted_access_token:["v1",parts[1],parts[2],ciphertext].join(":")}),"X_CRYPTO_DIAGNOSTIC_CIPHERTEXT_INVALID")
code(await classify({encrypted_access_token:envelope(markerToken,key,true)}),"X_CRYPTO_DIAGNOSTIC_DECRYPTION_SUCCEEDED")

// Exactly one authenticated decryption, with every local failure sanitized.
code(await classify({encrypted_access_token:envelope(markerToken,Buffer.alloc(32,8))}),"X_CRYPTO_DIAGNOSTIC_AUTHENTICATED_DECRYPTION_FAILED")
for(const index of [2,3]){const p=envelope().split(":");const bytes=Buffer.from(p[index],"base64url");bytes[0]^=1;p[index]=bytes.toString("base64url");code(await classify({encrypted_access_token:p.join(":")}),"X_CRYPTO_DIAGNOSTIC_AUTHENTICATED_DECRYPTION_FAILED")}
{const x=fixture({decryptAuthenticated:()=>{throw new Error("fake-crypto-exception-marker")}});code(await runXCryptoEnvelopeDiagnostic("u",x.deps),"X_CRYPTO_DIAGNOSTIC_AUTHENTICATED_DECRYPTION_FAILED");assert.equal(x.decrypts(),1)}
code(await classify({encrypted_access_token:envelope(" \n ")}),"X_CRYPTO_DIAGNOSTIC_DECRYPTED_TOKEN_INVALID")
code(await classify(),"X_CRYPTO_DIAGNOSTIC_DECRYPTION_SUCCEEDED")

// Source isolation, no mutation/provider capability, response sanitization, and product locks.
const helper=readFileSync("lib/autopost/xCryptoEnvelopeDiagnostic.ts","utf8"),route=readFileSync("app/api/admin/autopost/x/crypto-envelope-diagnostic/route.ts","utf8")
for(const text of ['runtime = "nodejs"','dynamic = "force-dynamic"','revalidate = 0','private, no-store, max-age=0','Pragma: "no-cache"','Expires: "0"','Referrer-Policy": "no-referrer"','X-Content-Type-Options": "nosniff"','export async function POST','export function GET','status: 405'])assert.ok(route.includes(text),text)
assert.ok(route.indexOf("getSupabaseAdmin()")>route.indexOf("loadAccount: async"))
for(const source of [helper,route])for(const bad of ["fetch(","/2/users/me","/2/tweets",".update(",".upsert(",".insert(",".delete(",".rpc(","refreshX","postX","from(\"fanvue","console.log","console.error"])assert.equal(source.toLowerCase().includes(bad.toLowerCase()),false,bad)
for(const path of ["app/autopost/AutopostPageClient.tsx","app/api/autopost/run/route.ts","vercel.json"])assert.equal(readFileSync(path,"utf8").includes("/api/admin/autopost/x/crypto-envelope-diagnostic"),false)
const old=process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED;try{process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED="false";const x=registry.getAutopostPlatformRegistry().find((p:any)=>p.id==="x")!;const status=availability.buildUserPlatformStatus(x,new Map([["x",{...account,provider_account_id:"fake",provider_username:"fake",encrypted_refresh_token:"fake",token_expires_at:"2099-01-01",metadata:{provider:"x",identity_fetched:true},last_error:null}]]) as any);assert.equal(status.public_selectable,false);assert.equal(status.can_schedule,false);assert.equal(process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED,"false")}finally{if(old===undefined)delete process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED;else process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED=old}
const serialized=JSON.stringify([xCryptoEnvelopeDiagnosticMethodNotAllowedResult(),await classify()]);for(const marker of [markerToken,keyText,"fake-db-error","fake-crypto-exception-marker"])assert.equal(serialized.includes(marker),false);for(const prohibited of ["key_length","decoded_length","hash","fingerprint","exception","plaintext","envelope_segment"])assert.equal(Object.keys(await classify()).includes(prohibited),false)
console.log("X crypto envelope diagnostic deterministic read-only tests passed; fake local evidence only; no network or Production action occurred.")
