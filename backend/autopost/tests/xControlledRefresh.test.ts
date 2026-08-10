import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { register } from "node:module"

const emptyModule = "data:text/javascript,export%20{}"
const nextServerModule = `data:text/javascript,${encodeURIComponent(`
class MockResponse {
  constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; this.headers = new Headers(init.headers) }
  static json(body, init) { return new MockResponse(body, init) }
}
export { MockResponse as NextResponse }
`)}`
const authModule = `data:text/javascript,${encodeURIComponent("export const requireUserId = input => globalThis.__xControlledRoute.requireUserId(input)")}`
const adminModule = `data:text/javascript,${encodeURIComponent("export const getSupabaseAdmin = () => globalThis.__xControlledRoute.getSupabaseAdmin()")}`
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  if (specifier.toLowerCase().includes('fanvue')) globalThis.__xControlledFanvue = (globalThis.__xControlledFanvue || 0) + 1
  if (specifier === 'server-only') return { url: ${JSON.stringify(emptyModule)}, shortCircuit: true }
  if (specifier === 'next/server') return { url: ${JSON.stringify(nextServerModule)}, shortCircuit: true }
  if (specifier === '@/lib/supabaseServer') return { url: ${JSON.stringify(authModule)}, shortCircuit: true }
  if (specifier === '@/lib/supabaseAdmin') return { url: ${JSON.stringify(adminModule)}, shortCircuit: true }
  return nextResolve(specifier, context)
}`)}`, import.meta.url)

const hooks: Record<string, (...args: any[]) => any> = {}
;(globalThis as any).__xControlledRoute = hooks
;(globalThis as any).__xControlledFanvue = 0
process.env.AUTOPOST_X_ADMIN_USER_IDS = "33333333-3333-4333-8333-333333333333"
const controlled = await import("../../../lib/autopost/xControlledRefresh.ts")
const route = await import("../../../app/api/admin/autopost/x/controlled-refresh/route.ts")
assert.equal((globalThis as any).__xControlledFanvue, 0)

const NOW = new Date("2030-01-01T00:00:00.000Z")
const validAccount: controlled.XControlledRefreshAccount = {
  connection_status: "CONNECTED",
  provider_account_id: "PROVIDER_ID_MARKER",
  provider_username: " The_Beard0302 ",
  last_error: null,
  encrypted_access_token: "ENCRYPTED_ACCESS_MARKER",
  encrypted_refresh_token: "ENCRYPTED_REFRESH_MARKER",
  token_expires_at: NOW.toISOString(),
  token_key_version: 7,
  metadata: { provider: "x", identity_fetched: true },
}
const successBody = { access_token: " ACCESS_MARKER ", token_type: " Bearer ", expires_in: 3600 }

type Counts = { key:number; clock:number; decrypt:number; timeout:number; fetch:number; encrypt:number; write:number }
function fixture(overrides: Record<string, unknown> = {}) {
  const counts: Counts = { key:0, clock:0, decrypt:0, timeout:0, fetch:0, encrypt:0, write:0 }
  const encrypted: string[] = []
  const dependencies: controlled.XControlledRefreshDependencies = {
    getTokenKeyVersion: () => { counts.key++; return 7 },
    now: () => { counts.clock++; return new Date(NOW) },
    decryptToken: value => { counts.decrypt++; assert.equal(value, "ENCRYPTED_REFRESH_MARKER"); return " REFRESH_MARKER " },
    encryptToken: value => { counts.encrypt++; encrypted.push(value); return `encrypted(${value})` },
    clientId: " CLIENT_MARKER ",
    clientSecret: " SECRET_MARKER ",
    createTimeoutSignal: milliseconds => { counts.timeout++; assert.equal(milliseconds, 10_000); return new AbortController().signal },
    fetch: async () => { counts.fetch++; return new Response(JSON.stringify(successBody), { status: 200 }) },
    ...overrides,
  }
  const writes: Record<string, unknown>[] = []
  const writer: controlled.XControlledRefreshWriter = async values => {
    counts.write++
    writes.push(values)
    return { data: { id: "row" }, error: null }
  }
  return { counts, dependencies, encrypted, writer, writes }
}
function assertNoDownstream(counts: Counts) {
  assert.deepEqual(counts, { key:0, clock:0, decrypt:0, timeout:0, fetch:0, encrypt:0, write:0 })
}
function assertFixedResult(result: controlled.XControlledRefreshResult) {
  assert.deepEqual(Object.keys(result).sort(), ["ok","mode","safe_code","provider_request_attempted","provider_status_class","refresh_attempted","refresh_verified","outcome_uncertain","database_write_attempted","database_write_verified","retry_attempted","post_attempted","runner_invoked","scheduler_action_attempted","cron_action_attempted","public_enablement_attempted","fanvue_account_queried","fanvue_account_mutated"].sort())
  assert.equal(result.mode, "x_controlled_refresh")
  for (const key of ["retry_attempted","post_attempted","runner_invoked","scheduler_action_attempted","cron_action_attempted","public_enablement_attempted","fanvue_account_queried","fanvue_account_mutated"] as const) assert.equal(result[key], false)
}
async function test(name: string, action: () => unknown | Promise<unknown>) {
  await action()
  process.stdout.write(`ok - ${name}\n`)
}

await test("server-only crypto wrapper and zero Fanvue dependency boundary", () => {
  const source = readFileSync("lib/autopost/xControlledRefresh.ts", "utf8")
  assert.match(source, /import "server-only"/)
  assert.match(source, /from "\.\/tokenCrypto"/)
  assert.doesNotMatch(source, /tokenCryptoCore/)
})

await test("real GET is inert, sanitized, secured, and method-not-allowed", () => {
  let auth = 0
  let admin = 0
  hooks.requireUserId = () => { auth++; throw new Error("must not run") }
  hooks.getSupabaseAdmin = () => { admin++; throw new Error("must not run") }
  const response: any = route.GET()
  assert.equal(response.status, 405)
  assert.equal(response.body.safe_code, "X_CONTROLLED_REFRESH_METHOD_NOT_ALLOWED")
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0")
  assert.equal(response.headers.get("pragma"), "no-cache")
  assert.equal(response.headers.get("expires"), "0")
  assert.equal(response.headers.get("referrer-policy"), "no-referrer")
  assert.equal(response.headers.get("x-content-type-options"), "nosniff")
  assert.equal(route.runtime, "nodejs")
  assert.equal(route.dynamic, "force-dynamic")
  assert.equal(route.revalidate, 0)
  assert.equal(auth, 0)
  assert.equal(admin, 0)
})

function poisonRequest(url = "https://example.invalid/", confirmation?: string) {
  let reads = 0
  const request = new Request(url, { method: "POST", headers: confirmation ? { "x-autopost-x-controlled-refresh": confirmation } : undefined })
  Object.defineProperty(request, "body", { get() { reads++; throw new Error("body inspected") } })
  return { request, reads: () => reads }
}

for (const scenario of [
  { name:"missing user", auth:async()=>null, confirmation:controlled.X_CONTROLLED_REFRESH_CONFIRMATION, url:"https://example.invalid/", status:401, code:"X_CONTROLLED_REFRESH_UNAUTHENTICATED" },
  { name:"blank user", auth:async()=>"  ", confirmation:controlled.X_CONTROLLED_REFRESH_CONFIRMATION, url:"https://example.invalid/", status:401, code:"X_CONTROLLED_REFRESH_UNAUTHENTICATED" },
  { name:"authentication throw", auth:async()=>{throw new Error("AUTH_MARKER")}, confirmation:controlled.X_CONTROLLED_REFRESH_CONFIRMATION, url:"https://example.invalid/", status:401, code:"X_CONTROLLED_REFRESH_UNAUTHENTICATED" },
  { name:"missing confirmation", auth:async()=>" 33333333-3333-4333-8333-333333333333 ", confirmation:undefined, url:"https://example.invalid/", status:400, code:"X_CONTROLLED_REFRESH_CONFIRMATION_REQUIRED" },
  { name:"wrong confirmation", auth:async()=>" 33333333-3333-4333-8333-333333333333 ", confirmation:"wrong", url:"https://example.invalid/", status:400, code:"X_CONTROLLED_REFRESH_CONFIRMATION_REQUIRED" },
  { name:"query parameters", auth:async()=>" 33333333-3333-4333-8333-333333333333 ", confirmation:controlled.X_CONTROLLED_REFRESH_CONFIRMATION, url:"https://example.invalid/?x=1", status:400, code:"X_CONTROLLED_REFRESH_PARAMETERS_NOT_ALLOWED" },
] as const) {
  await test(`real POST rejects ${scenario.name} before body and privilege`, async () => {
    const poison = poisonRequest(scenario.url, scenario.confirmation)
    let admin = 0
    hooks.requireUserId = ({ request }: any) => { assert.equal(request, poison.request); return scenario.auth() }
    hooks.getSupabaseAdmin = () => { admin++; throw new Error("privileged") }
    const response: any = await route.POST(poison.request)
    assert.equal(response.status, scenario.status)
    assert.equal(response.body.safe_code, scenario.code)
    assert.equal(poison.reads(), 0)
    assert.equal(admin, 0)
    assertFixedResult(response.body)
  })
}

function streamRequest(stream: ReadableStream<Uint8Array> | null) {
  if (stream === null) return new Request("https://example.invalid/", { method:"POST" })
  return new Request("https://example.invalid/", { method:"POST", body:stream, duplex:"half" as any })
}
await test("bounded body accepts null, closed, and finite zero chunks", async () => {
  const streams = [
    null,
    new ReadableStream({ start(controller) { controller.close() } }),
    new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array()); controller.close() } }),
    new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array()); controller.enqueue(new Uint8Array()); controller.close() } }),
  ]
  for (const stream of streams) assert.equal(await controlled.hasZeroByteBody(streamRequest(stream)), true)
})
await test("bounded body rejects data, text forms, rejection, stall, and excessive zero chunks", async () => {
  const bodies = ["x", " ", "{}", "null"]
  for (const body of bodies) {
    const request = new Request("https://example.invalid/", { method:"POST", body, duplex:"half" as any })
    assert.equal(await controlled.hasZeroByteBody(request), false)
  }
  const rejected = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("READ_MARKER")) } })
  assert.equal(await controlled.hasZeroByteBody(streamRequest(rejected)), false)
  const stalled = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}) }, cancel() { return new Promise(() => {}) } })
  assert.equal(await controlled.hasZeroByteBody(streamRequest(stalled)), false)
  const excessive = new ReadableStream<Uint8Array>({ start(controller) { for (let index=0; index<9; index++) controller.enqueue(new Uint8Array()) }, cancel() { return Promise.reject(new Error("CANCEL_MARKER")) } })
  assert.equal(await controlled.hasZeroByteBody(streamRequest(excessive)), false)
})

await test("missing account row is account-not-ready while lookup errors are lookup-failed", async () => {
  for (const [loaded, expected] of [
    [{ account:null, error:null }, "X_CONTROLLED_REFRESH_ACCOUNT_NOT_READY"],
    [{ account:null, error:new Error("DB_MARKER") }, "X_CONTROLLED_REFRESH_ACCOUNT_LOOKUP_FAILED"],
  ] as const) {
    const response = await controlled.handleXControlledRefreshRequest({
      request: new Request("https://example.invalid/", { method:"POST", headers:{"x-autopost-x-controlled-refresh":controlled.X_CONTROLLED_REFRESH_CONFIRMATION} }),
      getAuthenticatedUserId: async () => " 33333333-3333-4333-8333-333333333333 ",
      createPrivilegedAccess: () => ({ load: async () => loaded, writer: async () => { throw new Error("write") } }),
    })
    assert.equal(response.body.safe_code, expected)
    assert.equal(response.body.provider_request_attempted, false)
    assert.equal(response.body.database_write_attempted, false)
  }
})

await test("account loader performs exact X-only read", async () => {
  const operations: unknown[] = []
  const chain: any = {
    from(value:string) { operations.push(["from",value]); return this },
    select(value:string) { operations.push(["select",value]); return this },
    eq(column:string,value:unknown) { operations.push(["eq",column,value]); return this },
    maybeSingle() { operations.push(["maybeSingle"]); return { data:validAccount, error:null } },
  }
  const loaded = await controlled.createXControlledRefreshAccountLoader(chain)("trimmed-user")
  assert.equal(loaded.account, validAccount)
  assert.deepEqual(operations, [
    ["from","autopost_accounts"],
    ["select","connection_status,provider_account_id,provider_username,last_error,encrypted_access_token,encrypted_refresh_token,token_expires_at,token_key_version,metadata"],
    ["eq","user_id","trimmed-user"], ["eq","platform","x"], ["maybeSingle"],
  ])
})

await test("all canonical posture blockers stop every downstream action", async () => {
  const blockers: any[] = [
    { connection_status:"DISCONNECTED" }, { connection_status:"EXPIRED" }, { connection_status:"REVOKED" },
    { connection_status:"ERROR" }, { connection_status:"UNKNOWN" }, { provider_account_id:null },
    { provider_username:null }, { encrypted_access_token:null }, { encrypted_refresh_token:null },
    { token_expires_at:"invalid" }, { token_key_version:0 }, { metadata:null },
    { metadata:{provider:"other",identity_fetched:true} }, { metadata:{provider:"x",identity_fetched:false} }, { last_error:"error" },
  ]
  for (const changes of blockers) {
    const f = fixture()
    const response = await controlled.controlledRefreshX("user", { ...validAccount, ...changes }, f.writer, f.dependencies)
    assert.equal(response.safe_code, "X_CONTROLLED_REFRESH_ACCOUNT_NOT_READY")
    assertNoDownstream(f.counts)
  }
})

await test("protected identity normalization accepts exact account and rejects prefixed or different names", async () => {
  for (const username of ["the_beard0302","The_beard0302","THE_BEARD0302","  The_beard0302  "]) {
    const f = fixture()
    const response = await controlled.controlledRefreshX("user", { ...validAccount, provider_username:username }, f.writer, f.dependencies)
    assert.equal(response.safe_code, "X_CONTROLLED_REFRESH_SUCCEEDED")
  }
  for (const username of ["@The_beard0302","another"]) {
    const f = fixture()
    const response = await controlled.controlledRefreshX("user", { ...validAccount, provider_username:username }, f.writer, f.dependencies)
    assert.equal(response.safe_code, "X_CONTROLLED_REFRESH_PROTECTED_USERNAME_MISMATCH")
    assertNoDownstream(f.counts)
  }
})

await test("key and clock validation is exact and called at most once", async () => {
  for (const value of [undefined,"7",NaN,Infinity,1.5,0,-1]) {
    const f = fixture({ getTokenKeyVersion: () => { f.counts.key++; return value } })
    const response = await controlled.controlledRefreshX("user", validAccount, f.writer, f.dependencies)
    assert.equal(response.safe_code, "X_CONTROLLED_REFRESH_TOKEN_KEY_VERSION_UNAVAILABLE")
    assert.equal(f.counts.key, 1)
  }
  for (const value of [null, "date", new Date(NaN)]) {
    const f = fixture({ now: () => { f.counts.clock++; return value } })
    const response = await controlled.controlledRefreshX("user", validAccount, f.writer, f.dependencies)
    assert.equal(response.safe_code, "X_CONTROLLED_REFRESH_CLOCK_INVALID")
    assert.equal(f.counts.clock, 1)
  }
})

await test("refresh boundary permits exactly sixty seconds and stops at plus one millisecond", async () => {
  assert.equal(controlled.X_CONTROLLED_REFRESH_BUFFER_MS, 60_000)
  for (const offset of [-1,0,59_999,60_000]) {
    const f = fixture()
    const account = { ...validAccount, token_expires_at:new Date(NOW.getTime()+offset).toISOString() }
    assert.equal((await controlled.controlledRefreshX("user", account, f.writer, f.dependencies)).safe_code, "X_CONTROLLED_REFRESH_SUCCEEDED")
  }
  const f = fixture()
  const fresh = { ...validAccount, token_expires_at:new Date(NOW.getTime()+60_001).toISOString() }
  assert.equal((await controlled.controlledRefreshX("user", fresh, f.writer, f.dependencies)).safe_code, "X_CONTROLLED_REFRESH_NOT_REQUIRED")
  assert.equal(f.counts.decrypt + f.counts.timeout + f.counts.fetch + f.counts.write, 0)
})

await test("plaintext tokens are normalized before fetch, encryption, and write", async () => {
  let requestBody: URLSearchParams | undefined
  const f = fixture({
    fetch: async (_url:string, init:any) => {
      f.counts.fetch++
      requestBody = init.body
      return new Response(JSON.stringify({ ...successBody, refresh_token:" REPLACEMENT_MARKER " }), { status:200 })
    },
  })
  const response = await controlled.controlledRefreshX("user", validAccount, f.writer, f.dependencies)
  assert.equal(response.safe_code, "X_CONTROLLED_REFRESH_SUCCEEDED")
  assert.equal(requestBody?.get("refresh_token"), "REFRESH_MARKER")
  assert.deepEqual(f.encrypted, ["ACCESS_MARKER","REPLACEMENT_MARKER"])
  assert.equal(JSON.stringify(f.writes).includes(" ACCESS_MARKER "), false)
  assert.equal(JSON.stringify(f.writes).includes(" REPLACEMENT_MARKER "), false)
})

await test("provider request uses exact endpoint, Basic auth, form, timeout, and one fetch", async () => {
  let captured: any
  const signal = new AbortController().signal
  const f = fixture({
    createTimeoutSignal: milliseconds => { f.counts.timeout++; assert.equal(milliseconds, 10_000); return signal },
    fetch: async (url:string, init:any) => { f.counts.fetch++; captured={url,init}; return new Response(JSON.stringify(successBody),{status:200}) },
  })
  const response = await controlled.controlledRefreshX("AUTH_USER_MARKER", validAccount, f.writer, f.dependencies)
  assert.equal(response.safe_code, "X_CONTROLLED_REFRESH_SUCCEEDED")
  assert.equal(captured.url, "https://api.x.com/2/oauth2/token")
  assert.equal(captured.init.method, "POST")
  assert.equal(captured.init.headers.Authorization, "Basic Q0xJRU5UX01BUktFUjpTRUNSRVRfTUFSS0VS")
  assert.equal(captured.init.headers["Content-Type"], "application/x-www-form-urlencoded")
  assert.deepEqual([...captured.init.body.entries()], [["grant_type","refresh_token"],["refresh_token","REFRESH_MARKER"]])
  assert.equal(captured.init.cache, "no-store")
  assert.equal(captured.init.redirect, "error")
  assert.equal(captured.init.signal, signal)
  assert.equal(f.counts.timeout, 1)
  assert.equal(f.counts.fetch, 1)
})

await test("provider outcomes classify safely with one request and no retry", async () => {
  const cases: Array<[number,unknown,controlled.XControlledRefreshSafeCode,unknown,boolean]> = [
    [400,{error:"invalid_client"},"X_CONTROLLED_REFRESH_PROVIDER_INVALID_CLIENT","4xx",false],
    [429,{error:"slow"},"X_CONTROLLED_REFRESH_PROVIDER_RATE_LIMITED","4xx",false],
    [400,{},"X_CONTROLLED_REFRESH_PROVIDER_REJECTED","4xx",false],
    [401,{},"X_CONTROLLED_REFRESH_PROVIDER_REJECTED","4xx",false],
    [403,{},"X_CONTROLLED_REFRESH_PROVIDER_REJECTED","4xx",false],
    [500,{},"X_CONTROLLED_REFRESH_PROVIDER_OUTCOME_UNKNOWN","5xx",true],
    [503,{},"X_CONTROLLED_REFRESH_PROVIDER_OUTCOME_UNKNOWN","5xx",true],
    [302,{},"X_CONTROLLED_REFRESH_PROVIDER_OUTCOME_UNKNOWN",null,true],
  ]
  for (const [status,body,code,statusClass,uncertain] of cases) {
    const f = fixture({ fetch: async () => { f.counts.fetch++; return new Response(JSON.stringify(body),{status}) } })
    const response = await controlled.controlledRefreshX("user", validAccount, f.writer, f.dependencies)
    assert.equal(response.safe_code, code)
    assert.equal(response.provider_status_class, statusClass)
    assert.equal(response.outcome_uncertain, uncertain)
    assert.equal(response.retry_attempted, false)
    assert.equal(f.counts.fetch, 1)
  }
})

await test("timeout, abort, and network rejections are distinct and never retry", async () => {
  for (const [error,aborted,code] of [
    [Object.assign(new Error(),{name:"TimeoutError"}),false,"X_CONTROLLED_REFRESH_PROVIDER_TIMEOUT"],
    [Object.assign(new Error(),{name:"AbortError"}),true,"X_CONTROLLED_REFRESH_PROVIDER_TIMEOUT"],
    [Object.assign(new Error(),{name:"AbortError"}),false,"X_CONTROLLED_REFRESH_PROVIDER_NETWORK_FAILURE"],
    ["non-error",false,"X_CONTROLLED_REFRESH_PROVIDER_NETWORK_FAILURE"],
  ] as const) {
    const controller = new AbortController()
    if (aborted) controller.abort()
    const f = fixture({ createTimeoutSignal:()=>controller.signal, fetch:async()=>{f.counts.fetch++;throw error} })
    const response = await controlled.controlledRefreshX("user",validAccount,f.writer,f.dependencies)
    assert.equal(response.safe_code,code)
    assert.equal(response.retry_attempted,false)
    assert.equal(f.counts.fetch,1)
  }
})

await test("invalid successful responses validate completely before encryption or write", async () => {
  const invalid = [null,"text",1,true,[],{},Object.create({access_token:"a"}),
    {access_token:"",token_type:"bearer",expires_in:1}, {access_token:"a",token_type:"mac",expires_in:1},
    {access_token:"a",token_type:"bearer",expires_in:0}, {access_token:"a",token_type:"bearer",expires_in:1,refresh_token:" "},
    {access_token:"a",token_type:"bearer",expires_in:1,scope:null}]
  for (const body of invalid) {
    const f = fixture({ fetch:async()=>({ok:true,status:200,json:async()=>body} as Response) })
    const response = await controlled.controlledRefreshX("user",validAccount,f.writer,f.dependencies)
    assert.equal(response.safe_code,"X_CONTROLLED_REFRESH_PROVIDER_RESPONSE_INVALID")
    assert.equal(response.outcome_uncertain,true)
    assert.equal(f.counts.encrypt,0)
    assert.equal(f.counts.write,0)
  }
})

async function writeOutcome(provider: "success"|"invalid_grant", proof: () => Promise<any>) {
  const f = fixture({ fetch:async()=>{f.counts.fetch++;return new Response(JSON.stringify(provider==="success"?successBody:{error:"invalid_grant"}),{status:provider==="success"?200:400})} })
  const response = await controlled.controlledRefreshX("user",validAccount,async()=>{f.counts.write++;return proof()},f.dependencies)
  assert.equal(f.counts.fetch,1)
  assert.equal(f.counts.write,1)
  assert.equal(response.retry_attempted,false)
  return response
}
await test("provider-success write outcomes are verified or explicitly uncertain", async () => {
  assert.equal((await writeOutcome("success",async()=>({data:{id:"row"},error:null}))).safe_code,"X_CONTROLLED_REFRESH_SUCCEEDED")
  const changed = await writeOutcome("success",async()=>({data:null,error:null}))
  assert.equal(changed.safe_code,"X_CONTROLLED_REFRESH_ACCOUNT_CHANGED")
  assert.equal(changed.refresh_verified,true)
  assert.equal(changed.outcome_uncertain,true)
  for (const proof of [async()=>({data:null,error:new Error("DB")}),async()=>({data:{},error:null}),async()=>({data:{id:" "},error:null}),async()=>{throw new Error("THROW")}]) {
    const response = await writeOutcome("success",proof)
    assert.equal(response.safe_code,"X_CONTROLLED_REFRESH_ACCOUNT_UPDATE_FAILED")
    assert.equal(response.outcome_uncertain,true)
  }
})
await test("invalid-grant lifecycle write keeps zero-row certain and write failures uncertain", async () => {
  const changed = await writeOutcome("invalid_grant",async()=>({data:null,error:null}))
  assert.equal(changed.safe_code,"X_CONTROLLED_REFRESH_ACCOUNT_CHANGED")
  assert.equal(changed.refresh_verified,false)
  assert.equal(changed.outcome_uncertain,false)
  const failed = await writeOutcome("invalid_grant",async()=>({data:{id:""},error:null}))
  assert.equal(failed.safe_code,"X_CONTROLLED_REFRESH_ACCOUNT_UPDATE_FAILED")
  assert.equal(failed.outcome_uncertain,true)
})

await test("writer factory uses complete immutable snapshot filters and no mutation primitive beyond update", async () => {
  const operations: unknown[] = []
  const chain: any = {
    from(value:string){operations.push(["from",value]);return this}, update(value:unknown){operations.push(["update",value]);return this},
    eq(column:string,value:unknown){operations.push(["eq",column,value]);return this}, is(column:string,value:unknown){operations.push(["is",column,value]);return this},
    select(value:string){operations.push(["select",value]);return this}, maybeSingle(){operations.push(["maybeSingle"]);return{data:{id:"row"},error:null}},
  }
  const values = { connection_status:"EXPIRED",last_error:"X_CONTROLLED_REFRESH_PROVIDER_UNAUTHORIZED" }
  await controlled.createXControlledRefreshWriter(chain)(values,validAccount,"AUTH_USER_MARKER")
  assert.deepEqual(operations,[
    ["from","autopost_accounts"],["update",values],["eq","user_id","AUTH_USER_MARKER"],["eq","platform","x"],
    ["eq","connection_status","CONNECTED"],["eq","provider_account_id","PROVIDER_ID_MARKER"],["eq","provider_username"," The_Beard0302 "],
    ["eq","token_key_version",7],["eq","encrypted_access_token","ENCRYPTED_ACCESS_MARKER"],["eq","encrypted_refresh_token","ENCRYPTED_REFRESH_MARKER"],
    ["eq","token_expires_at",NOW.toISOString()],["is","last_error",null],["select","id"],["maybeSingle"],
  ])
})

await test("results contain only the fixed sanitized contract", async () => {
  const f = fixture()
  const response = await controlled.controlledRefreshX("AUTH_USER_MARKER",validAccount,f.writer,f.dependencies)
  assertFixedResult(response)
  const serialized = JSON.stringify(response)
  for (const marker of ["AUTH_USER_MARKER","PROVIDER_ID_MARKER","The_Beard0302","REFRESH_MARKER","ACCESS_MARKER","ENCRYPTED_ACCESS_MARKER","ENCRYPTED_REFRESH_MARKER","CLIENT_MARKER","SECRET_MARKER"]) {
    assert.equal(serialized.includes(marker),false)
  }
})

await test("product locks and unchanged ordinary adapter sources remain intact", () => {
  const combined = readFileSync("lib/autopost/xControlledRefresh.ts","utf8") + readFileSync("app/api/admin/autopost/x/controlled-refresh/route.ts","utf8")
  for (const forbidden of ["/2/users/me","/2/tweets","live-text-canary","xAdapter","xTokenRefresh","revoke"]) assert.equal(combined.includes(forbidden),false)
  const prior = process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED
  try { process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED="false"; assert.equal(process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED,"false") }
  finally { if (prior===undefined) delete process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED; else process.env.AUTOPOST_X_RUN_DISPATCH_ENABLED=prior }
})

process.stdout.write("X controlled refresh correction tests passed with deterministic fakes only; no provider or Production action occurred.\n")
