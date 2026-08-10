import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { register } from "node:module"

register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export default {}', shortCircuit: true }
  return nextResolve(specifier, context)
}`)}`, import.meta.url)

const { requireXAdminUserId } = await import("../../../lib/autopost/xAdminAuthorization.ts")
const ADMIN = "11111111-1111-4111-8111-111111111111"
const NON_ADMIN = "22222222-2222-4222-8222-222222222222"

async function denied(authenticatedUserId: string | null, allowlist: string | undefined) {
  const activity = { admin: 0, token: 0, provider: 0, persistence: 0 }
  const guardedOperation = async () => {
    await requireXAdminUserId(
      { request: new Request("https://local.invalid/api/admin/autopost/x/test") },
      {
        requireAuthenticatedUserId: async () => {
          if (authenticatedUserId === null) throw new Error("Unauthenticated")
          return authenticatedUserId
        },
        readAdminUserIds: () => allowlist,
      }
    )
    activity.admin++
    activity.token++
    activity.provider++
    activity.persistence++
  }
  await assert.rejects(guardedOperation, /Unauthorized|Unauthenticated/)
  assert.deepEqual(activity, { admin: 0, token: 0, provider: 0, persistence: 0 })
}

await denied(null, ADMIN)
await denied(NON_ADMIN, ADMIN)
await denied(ADMIN, undefined)
await denied(ADMIN, "")
await denied(ADMIN, "  , \t,  ")
await denied(ADMIN, "not-a-uuid")
await denied(ADMIN, "not-a-uuid, also-not-a-uuid, 1234")
await denied("not-an-authenticated-uuid", ADMIN)

const verified = await requireXAdminUserId({}, {
  requireAuthenticatedUserId: async () => ` ${ADMIN} `,
  readAdminUserIds: () => ` not-a-uuid, ${NON_ADMIN},,  ${ADMIN.toUpperCase()} , malformed `,
})
assert.equal(verified, ADMIN)
await denied("33333333-3333-4333-8333-333333333333", ` , ${NON_ADMIN},, ${ADMIN}, `)

const normalized = await requireXAdminUserId({}, {
  requireAuthenticatedUserId: async () => ADMIN,
  readAdminUserIds: () => ` , ${NON_ADMIN},,  ${ADMIN} , `,
})
assert.equal(normalized, ADMIN)

const routes = [
  "reauthorize",
  "live-text-canary",
  "controlled-refresh",
  "identity-diagnostic",
  "crypto-envelope-diagnostic",
] as const
const privilegedMarkers = [
  "getSupabaseAdmin()",
  "createXReauthorizationOAuthState(",
  "buildXAuthorizeUrl(",
]
for (const routeName of routes) {
  const path = `app/api/admin/autopost/x/${routeName}/route.ts`
  const source = readFileSync(path, "utf8")
  const authorization = source.indexOf("requireXAdminUserId(")
  assert.ok(authorization >= 0, `${path} uses the shared X-admin boundary`)
  for (const marker of privilegedMarkers) {
    const privileged = source.indexOf(marker)
    if (privileged >= 0) assert.ok(authorization < privileged, `${path}: authorization precedes ${marker}`)
  }
}

const sourceByRoute = Object.fromEntries(routes.map((name) => [name, readFileSync(`app/api/admin/autopost/x/${name}/route.ts`, "utf8")]))
assert.ok(sourceByRoute.reauthorize.includes("x-autopost-x-reauthorize"))

const protectionSources = {
  live: readFileSync("lib/autopost/xLiveTextCanary.ts", "utf8"),
  refresh: readFileSync("lib/autopost/xControlledRefresh.ts", "utf8"),
  identity: readFileSync("lib/autopost/xIdentityDiagnostic.ts", "utf8"),
  crypto: readFileSync("lib/autopost/xCryptoEnvelopeDiagnostic.ts", "utf8"),
}
for (const [name, source] of Object.entries(protectionSources)) {
  assert.match(source, /CONFIRMATION/, `${name} confirmation remains present`)
}
assert.match(protectionSources.live, /PROTECTED_USERNAME/)
assert.match(protectionSources.refresh, /PROTECTED_USERNAME/)

const envExample = readFileSync(".env.example", "utf8")
assert.match(envExample, /^AUTOPOST_X_ADMIN_USER_IDS=$/m)
assert.doesNotMatch(envExample, /AUTOPOST_X_ADMIN_USER_IDS=.*[0-9a-f]{8}-/i)

console.log("LOCK-02E X admin authorization tests passed; local fakes only; zero network or Production activity.")
