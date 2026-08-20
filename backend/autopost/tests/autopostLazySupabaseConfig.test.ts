import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { register } from "node:module"

delete process.env.SUPABASE_URL
delete process.env.NEXT_PUBLIC_SUPABASE_URL
delete process.env.SUPABASE_SERVICE_ROLE_KEY
delete process.env.CRON_SECRET
delete process.env.VERCEL_CRON_SECRET

const emptyServerOnlyModule = "data:text/javascript,export%20{}"
const loaderSource = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') return { url: ${JSON.stringify(emptyServerOnlyModule)}, shortCircuit: true }
  return nextResolve(specifier, context)
}
`
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url)

const originalFetch = globalThis.fetch
globalThis.fetch = async () => {
  throw new Error("no external call is permitted in the lazy configuration regression test")
}

try {
  const { executeAutopost } = await import("../../../app/api/autopost/run/route")
  const routeSource = readFileSync("app/api/autopost/run/route.ts", "utf8")
  assert.doesNotMatch(routeSource, /const supabaseAdmin = createClient/, "route must not construct a client at module scope")

  const unauthorized = await executeAutopost(new Request("http://local.test/api/autopost/run"))
  assert.equal(unauthorized.status, 401)
  assert.deepEqual(await unauthorized.json(), { ok: false, error: "CRON_SECRET_NOT_CONFIGURED" })

  const missingConfig = await executeAutopost(new Request("http://local.test/api/autopost/run", {
    headers: { authorization: "Bearer test-cron-secret" },
  }), {
    cronSecret: "test-cron-secret",
    env: {},
  })
  assert.equal(missingConfig.status, 500)
  assert.deepEqual(await missingConfig.json(), { ok: false, error: "SUPABASE_ADMIN_NOT_CONFIGURED" })

  let databaseReads = 0
  const injectedDb = {
    from(table: string) {
      assert.equal(table, "autopost_rules")
      databaseReads += 1
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        not: () => query,
        lte: async () => ({ data: [], error: null }),
      }
      return query
    },
  }
  const injected = await executeAutopost(new Request("http://local.test/api/autopost/run", {
    headers: { authorization: "Bearer test-cron-secret" },
  }), {
    supabaseAdmin: injectedDb as never,
    cronSecret: "test-cron-secret",
    env: {},
  })
  assert.equal(injected.status, 200)
  assert.equal((await injected.json()).ok, true)
  assert.equal(databaseReads, 1)
} finally {
  globalThis.fetch = originalFetch
}

console.log("AutoPost lazy Supabase configuration tests passed")
