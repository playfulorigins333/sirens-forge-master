import assert from "node:assert/strict"
import { readdirSync, statSync } from "node:fs"
import path from "node:path"
import {
  LEGACY_AUTOPOST_ADMIN_ENABLE_ENV,
  isPublicPath,
  legacyAutopostAdminEnabled,
  shouldBlockLegacyAutopostAdmin,
} from "../../../proxy"

const root = process.cwd()
const legacyAdminRoot = path.join(root, "app/api/admin/autopost")

function collectRouteFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const absolute = path.join(dir, entry)
    if (statSync(absolute).isDirectory()) out.push(...collectRouteFiles(absolute))
    else if (entry === "route.ts") out.push(absolute)
  }
  return out
}

function routePath(file: string) {
  const relative = path.relative(path.join(root, "app"), path.dirname(file)).split(path.sep).join("/")
  return `/${relative}`
}

const legacyRoutes = collectRouteFiles(legacyAdminRoot).map(routePath).sort()
assert.equal(legacyRoutes.length, 20, "legacy Autopost admin route inventory changed; review the Phase 8I boundary deliberately")

assert.equal(LEGACY_AUTOPOST_ADMIN_ENABLE_ENV, "SIRENS_LEGACY_AUTOPOST_ADMIN_ENABLED")
assert.equal(legacyAutopostAdminEnabled({}), false)
assert.equal(legacyAutopostAdminEnabled({ SIRENS_LEGACY_AUTOPOST_ADMIN_ENABLED: "false" }), false)
assert.equal(legacyAutopostAdminEnabled({ SIRENS_LEGACY_AUTOPOST_ADMIN_ENABLED: "TRUE" }), false)
assert.equal(legacyAutopostAdminEnabled({ SIRENS_LEGACY_AUTOPOST_ADMIN_ENABLED: "true" }), true)

for (const pathname of legacyRoutes) {
  assert.equal(isPublicPath(pathname), true, `${pathname} still traverses the API proxy namespace`)
  assert.equal(shouldBlockLegacyAutopostAdmin(pathname, {}), true, `${pathname} must fail closed by default`)
  assert.equal(
    shouldBlockLegacyAutopostAdmin(pathname, { SIRENS_LEGACY_AUTOPOST_ADMIN_ENABLED: "true" }),
    false,
    `${pathname} may pass the launch kill switch only during an explicit controlled diagnostic window`,
  )
}

for (const pathname of [
  "/api/creator-publishing-queue/fanvue/run",
  "/api/admin/governance/legal-holds",
  "/api/admin/affiliate-payouts/execute",
  "/api/account/data-export",
]) {
  assert.equal(shouldBlockLegacyAutopostAdmin(pathname, {}), false, `${pathname} is outside the legacy Autopost admin kill switch`)
}

const proxySource = await import("node:fs").then(({ readFileSync }) => readFileSync(path.join(root, "proxy.ts"), "utf8"))
assert(proxySource.indexOf("shouldBlockLegacyAutopostAdmin(pathname)") < proxySource.indexOf("isPublicPath(pathname)"), "legacy admin block must run before generic /api pass-through")
assert.match(proxySource, /status:\s*404/)
assert.match(proxySource, /"Cache-Control":\s*"no-store"/)
assert.doesNotMatch(proxySource, /creator-publishing-queue\/fanvue\/run.*404/s)

console.log("Phase 8I launch/admin hygiene contract: PASS")
