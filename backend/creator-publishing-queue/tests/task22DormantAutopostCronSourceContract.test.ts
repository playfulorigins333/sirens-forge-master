import assert from "node:assert/strict"
import test from "node:test"
import { existsSync, readFileSync } from "node:fs"

const vercelPath = "vercel.json"
const routePath = "app/api/autopost/run/route.ts"

type VercelCron = {
  path?: unknown
  schedule?: unknown
}

type VercelConfig = {
  version?: unknown
  crons?: unknown
}

function readVercelConfig(): VercelConfig {
  return JSON.parse(readFileSync(vercelPath, "utf8")) as VercelConfig
}

function configuredCrons(config: VercelConfig): VercelCron[] {
  if (config.crons === undefined) return []
  assert.ok(Array.isArray(config.crons), "vercel.json crons must be an array when present")
  return config.crons as VercelCron[]
}

test("vercel config registers no dormant AutoPost or Creator Publishing cron", () => {
  const config = readVercelConfig()
  const crons = configuredCrons(config)

  assert.equal(config.version, 2)
  assert.equal(crons.length, 0)
  assert.equal(config.crons, undefined)
  assert.deepEqual(Object.keys(config).sort(), ["version"])

  for (const cron of crons) {
    assert.notEqual(cron.path, "/api/autopost/run")
    assert.notEqual(cron.path, "/api/creator-publishing-queue/scheduler/run")
    assert.doesNotMatch(String(cron.path ?? ""), /autopost|creator-publishing/i)
    assert.doesNotMatch(String(cron.schedule ?? ""), /\S/)
  }
})

test("dormant AutoPost run route source remains present and cron-authenticated", () => {
  assert.equal(existsSync(routePath), true)
  const route = readFileSync(routePath, "utf8")

  assert.match(route, /export const runtime = "nodejs"/)
  assert.match(route, /export const dynamic = "force-dynamic"/)
  assert.match(route, /function assertCronAuth\(req: Request, cronSecret = CRON_SECRET\)/)
  assert.match(route, /if \(!cronSecret\) \{\s*return \{ ok: false as const, error: "CRON_SECRET_NOT_CONFIGURED" \};?\s*\}/s)
  assert.match(route, /headers\.get\("authorization"\)/)
  assert.match(route, /headers\.get\("x-vercel-cron-secret"\)/)
  assert.match(route, /auth === `Bearer \$\{cronSecret\}`/)
  assert.match(route, /xCron === cronSecret/)
  assert.match(route, /const auth = assertCronAuth\(req, deps\.cronSecret\)/)
  assert.match(route, /if \(!auth\.ok\) return json\(401, auth\)/)
  assert.match(route, /export async function GET\(req: Request\)/)
  assert.match(route, /export async function POST\(req: Request\)/)
})

test("dormant route keeps foundation, claim, and dispatch safeguards narrow", () => {
  const route = readFileSync(routePath, "utf8")

  assert.match(route, /function getFoundationSchedulablePlatforms\(req: Request\): AutopostProofPlatform\[\] \{[\s\S]*?if \(url\.searchParams\.get\("foundation"\) === "1"\) \{\s*return \["x"\];?\s*\}[\s\S]*?return \[\];?/)
  assert.match(route, /function shouldClaimJobs\(req: Request\) \{\s*return new URL\(req\.url\)\.searchParams\.get\("claim"\) === "1";?\s*\}/)
  assert.match(route, /function isDispatchGateEnabled\(req: Request, env: Record<string, string \| undefined> = process\.env\) \{[\s\S]*?const requested = url\.searchParams\.get\("dispatch"\) === "1" \|\| url\.searchParams\.get\("execute"\) === "1"[\s\S]*?return requested && env\.AUTOPOST_X_RUN_DISPATCH_ENABLED === "true"/)
  assert.match(route, /const schedulablePlatforms: AutopostProofPlatform\[\] = dispatchEnabled \? \["x"\] : getFoundationSchedulablePlatforms\(req\)/)
  assert.match(route, /const claimJobs = shouldClaimJobs\(req\) \|\| dispatchEnabled/)
  assert.match(route, /if \(dispatchEnabled\) \{\s*summary\.dispatches_attempted\+\+;?\s*summary\.posts_attempted\+\+;?/)
  assert.match(route, /postXTextOnlyAutopost\(/)
})
