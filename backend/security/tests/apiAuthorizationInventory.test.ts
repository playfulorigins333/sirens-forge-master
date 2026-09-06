import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const root = process.cwd()
const apiRoot = path.join(root, "app/api")
const inventoryPaths = [
  path.join(root, "docs/security/api-authorization-inventory.md"),
  path.join(root, "docs/security/api-authorization-inventory-phase8c.md"),
  path.join(root, "docs/security/api-authorization-inventory-phase8d.md"),
  path.join(root, "docs/security/api-authorization-inventory-phase8f.md"),
  path.join(root, "docs/security/api-authorization-inventory-phase9.md"),
  path.join(root, "docs/security/api-authorization-inventory-phase10.md"),
]
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const
const allowedTaxonomy = new Set(["PUBLIC", "AUTHENTICATED", "FRESH_TOTP", "OWNER", "ENTITLED", "ADMIN", "SCHEDULER_SECRET", "WEBHOOK_SIGNATURE", "OAUTH_CALLBACK", "INTERNAL_CONTROLLED"])
const allowedStatuses = new Set(["PASS", "FIXED-IN-THIS-GATE", "BLOCKED-FROZEN", "NEEDS-SEPARATE-DESIGN"])

async function routeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return routeFiles(absolute)
    return entry.isFile() && entry.name === "route.ts" ? [path.relative(root, absolute).split(path.sep).join("/")] : []
  }))
  return nested.flat().sort()
}

function exportedMethods(source: string): string[] {
  const pattern = /export\s+(?:(?:async\s+)?function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g
  return [...source.matchAll(pattern)].map((match) => match[1]).filter((method, index, all) => all.indexOf(method) === index).sort()
}

function cells(line: string): string[] {
  return line.slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll("\\|", "|"))
}

const markdownParts = await Promise.all(inventoryPaths.map((inventoryPath) => readFile(inventoryPath, "utf8")))
const markdown = markdownParts.join("\n")
const tableLines = markdown.split("\n").filter((line) => line.startsWith("| `/api/") || line.startsWith("| `/api`"))
assert.ok(tableLines.length > 0, "inventory must contain route rows")
const rows = tableLines.map(cells)
assert.ok(rows.every((row) => row.length === 14), "every inventory row must provide all 14 required fields")
assert.ok(rows.every((row) => row.every(Boolean)), "required inventory metadata must not be blank")

const actualFiles = await routeFiles(apiRoot)
const inventoriedFiles = [...new Set(rows.map((row) => row[1].replaceAll("`", "")))].sort()
assert.deepEqual(inventoriedFiles, actualFiles, "route files and inventory must be an exact bidirectional match")

const expectedEntries: string[] = []
for (const file of actualFiles) {
  const source = await readFile(path.join(root, file), "utf8")
  const route = `/api/${path.dirname(file).slice("app/api/".length)}`
  const routeMethods = exportedMethods(source)
  assert.ok(routeMethods.length > 0, `${file} must export at least one supported HTTP method`)
  for (const method of routeMethods) expectedEntries.push(`${route}|${method}`)
}
expectedEntries.sort()
const inventoryEntries = rows.map((row) => `${row[0].replaceAll("`", "")}|${row[2].replaceAll("`", "")}`).sort()
assert.equal(new Set(inventoryEntries).size, inventoryEntries.length, "duplicate route/method inventory entry")
assert.deepEqual(inventoryEntries, expectedEntries, "exported HTTP methods and inventory rows must match exactly")

for (const row of rows) {
  const classes = row[4].split("+").map((value) => value.trim())
  assert.ok(classes.length > 0 && classes.every((value) => allowedTaxonomy.has(value)), `invalid authorization taxonomy: ${row[4]}`)
  assert.ok(allowedStatuses.has(row[12]), `invalid reviewed status: ${row[12]}`)
}

function inventoryRow(route: string, method: string): string[] {
  const row = rows.find((candidate) => candidate[0] === `\`${route}\`` && candidate[2] === `\`${method}\``)
  assert.ok(row, `missing semantic inventory row for ${method} ${route}`)
  return row
}

function authorizationClasses(row: string[]): Set<string> {
  return new Set(row[4].split("+").map((value) => value.trim()))
}

const webhookPostClasses = authorizationClasses(inventoryRow("/api/webhook", "POST"))
assert.ok(webhookPostClasses.has("WEBHOOK_SIGNATURE"), "POST /api/webhook must record signature authentication")
assert.ok(!webhookPostClasses.has("PUBLIC"), "POST /api/webhook must not be public")

const webhookGetClasses = authorizationClasses(inventoryRow("/api/webhook", "GET"))
assert.ok(webhookGetClasses.has("PUBLIC"), "GET /api/webhook must record its public status contract")
assert.ok(!webhookGetClasses.has("WEBHOOK_SIGNATURE"), "GET /api/webhook does not verify a webhook signature")

const inertLegacyEntries = [
  ["/api/autopost/platforms/fanvue", "POST"],
  ["/api/autopost/platforms/fansly", "POST"],
  ["/api/autopost/platforms/manyvids", "POST"],
  ["/api/autopost/platforms/manyvids", "GET"],
  ["/api/autopost/platforms/onlyfans", "POST"],
  ["/api/autopost/platforms/onlyfans", "GET"],
  ["/api/autopost/platforms/reddit", "POST"],
  ["/api/autopost/platforms/reddit", "GET"],
  ["/api/autopost/platforms/x", "GET"],
] as const
const forbiddenInertClaims = ["AUTHENTICATED", "OWNER", "SCHEDULER_SECRET", "WEBHOOK_SIGNATURE", "OAUTH_CALLBACK"]
for (const [route, method] of inertLegacyEntries) {
  const classes = authorizationClasses(inventoryRow(route, method))
  assert.ok(classes.has("PUBLIC"), `${method} ${route} must record its unauthenticated inert contract`)
  for (const claim of forbiddenInertClaims) assert.ok(!classes.has(claim), `${method} ${route} must not claim ${claim}`)
}

const publicXAdminGetRoutes = [
  "/api/admin/autopost/x/controlled-refresh",
  "/api/admin/autopost/x/crypto-envelope-diagnostic",
  "/api/admin/autopost/x/identity-diagnostic",
  "/api/admin/autopost/x/live-text-canary",
  "/api/admin/autopost/x/reauthorize",
] as const
const forbiddenPublicXAdminGetClaims = ["AUTHENTICATED", "OWNER", "ADMIN", "INTERNAL_CONTROLLED", "SCHEDULER_SECRET", "WEBHOOK_SIGNATURE", "OAUTH_CALLBACK"]
for (const route of publicXAdminGetRoutes) {
  const getRow = inventoryRow(route, "GET")
  const getClasses = authorizationClasses(getRow)
  assert.ok(getClasses.has("PUBLIC"), `GET ${route} must record its static public 405 contract`)
  for (const claim of forbiddenPublicXAdminGetClaims) assert.ok(!getClasses.has(claim), `GET ${route} must not claim ${claim}`)
  assert.match(getRow[11], /405.+no privileged action/i, `GET ${route} must record the static 405/no-privileged-action contract`)

  const postClasses = authorizationClasses(inventoryRow(route, "POST"))
  assert.ok(postClasses.has("AUTHENTICATED"), `POST ${route} must remain authenticated`)
  assert.ok(postClasses.has("ADMIN"), `POST ${route} must remain admin-protected`)
  assert.ok(postClasses.has("INTERNAL_CONTROLLED"), `POST ${route} must remain internally controlled`)
  assert.ok(!postClasses.has("PUBLIC"), `POST ${route} must not be public`)
}

const xPost = inventoryRow("/api/autopost/platforms/x", "POST")
const xPostClasses = authorizationClasses(xPost)
assert.ok(xPostClasses.has("INTERNAL_CONTROLLED"), "POST /api/autopost/platforms/x must record its internal control")
assert.ok(!xPostClasses.has("PUBLIC"), "POST /api/autopost/platforms/x must not be public")
assert.match(xPost[5], /x-autopost-internal-secret.+AUTOPOST_INTERNAL_ADAPTER_SECRET/i, "X POST authentication metadata must name its header and configured secret")
assert.match(xPost[10], /Supabase admin.+X account.+decrypt\/refresh.+POST to X/i, "X POST privileged-use metadata must record downstream account, token, and provider access")

const datasetDecisionPost = inventoryRow("/api/lora/dataset-training-decision", "POST")
const datasetDecisionClasses = authorizationClasses(datasetDecisionPost)
for (const required of ["AUTHENTICATED", "OWNER", "ENTITLED"]) assert.ok(datasetDecisionClasses.has(required), `dataset decision must record ${required}`)
assert.match(datasetDecisionPost[5], /ensureActiveSubscription\(\).+before privileged access/i)
assert.match(datasetDecisionPost[10], /getSupabaseAdmin\(\).+only after authentication\/entitlement/i)

const identitySeedPost = inventoryRow("/api/lora/identity-seed", "POST")
const identitySeedClasses = authorizationClasses(identitySeedPost)
for (const required of ["AUTHENTICATED", "OWNER", "ENTITLED"]) {
  assert.ok(identitySeedClasses.has(required), `POST /api/lora/identity-seed must record ${required}`)
}
for (const forbidden of ["PUBLIC", "ADMIN", "INTERNAL_CONTROLLED"]) {
  assert.ok(!identitySeedClasses.has(forbidden), `POST /api/lora/identity-seed must not claim ${forbidden}`)
}
assert.match(identitySeedPost[5], /ensureActiveSubscription\(\).+authenticated.+entitlement.+before privileged mutation/i, "identity-seed must record authentication/entitlement before privileged mutation")
assert.match(identitySeedPost[6], /cannot choose.+user_id.+derived exclusively from.+auth\.user\.id/i, "identity-seed must record authenticated-user-derived ownership")
assert.match(identitySeedPost[10], /getSupabaseAdmin\(\).+after successful authentication\/entitlement validation.+service-role insert binds.+auth\.user\.id.+never exposed to the browser/i, "identity-seed must record server-only service-role use")

const phase8cRetentionGet = inventoryRow("/api/internal/retention/phase8c/run", "GET")
const phase8cRetentionClasses = authorizationClasses(phase8cRetentionGet)
assert.ok(phase8cRetentionClasses.has("SCHEDULER_SECRET"), "Phase 8C retention runner must record scheduler-secret authentication")
assert.ok(phase8cRetentionClasses.has("INTERNAL_CONTROLLED"), "Phase 8C retention runner must remain internal-only")
assert.ok(!phase8cRetentionClasses.has("PUBLIC"), "Phase 8C retention runner must not be public")
assert.match(phase8cRetentionGet[5], /authenticateSchedulerRequest\(\).+CRON_SECRET.+VERCEL_CRON_SECRET/i)
assert.match(phase8cRetentionGet[10], /Supabase admin.+after scheduler authentication/i)

const phase8dRetentionGet = inventoryRow("/api/internal/retention/phase8d/run", "GET")
const phase8dRetentionClasses = authorizationClasses(phase8dRetentionGet)
assert.ok(phase8dRetentionClasses.has("SCHEDULER_SECRET"), "Phase 8D retention runner must record scheduler-secret authentication")
assert.ok(phase8dRetentionClasses.has("INTERNAL_CONTROLLED"), "Phase 8D retention runner must remain internal-only")
assert.ok(!phase8dRetentionClasses.has("PUBLIC"), "Phase 8D retention runner must not be public")
assert.match(phase8dRetentionGet[5], /authenticateSchedulerRequest\(\).+CRON_SECRET.+VERCEL_CRON_SECRET/i)
assert.match(phase8dRetentionGet[10], /Supabase admin.+after scheduler authentication/i)

for (const [route, method] of [
  ["/api/admin/governance/legal-holds", "GET"],
  ["/api/admin/governance/legal-holds", "POST"],
  ["/api/admin/governance/legal-holds/[holdId]/review", "POST"],
  ["/api/admin/governance/legal-holds/[holdId]/release", "POST"],
] as const) {
  const classes = authorizationClasses(inventoryRow(route, method))
  for (const required of ["AUTHENTICATED", "FRESH_TOTP", "ADMIN"]) assert.ok(classes.has(required), `${method} ${route} must record ${required}`)
  assert.ok(!classes.has("PUBLIC"), `${method} ${route} must not be public`)
}

const phase8fExpiryGet = inventoryRow("/api/internal/governance/legal-holds/expire", "GET")
const phase8fExpiryClasses = authorizationClasses(phase8fExpiryGet)
assert.ok(phase8fExpiryClasses.has("SCHEDULER_SECRET"), "Phase 8F expiry runner must record scheduler-secret authentication")
assert.ok(phase8fExpiryClasses.has("INTERNAL_CONTROLLED"), "Phase 8F expiry runner must remain internal-only")
assert.ok(!phase8fExpiryClasses.has("PUBLIC"), "Phase 8F expiry runner must not be public")
assert.match(phase8fExpiryGet[5], /authenticateSchedulerRequest\(\).+CRON_SECRET.+VERCEL_CRON_SECRET/i)
assert.match(phase8fExpiryGet[10], /Supabase admin.+after scheduler authentication/i)

assert.match(markdown, new RegExp(`\\*\\*Combined inventory:\\*\\* ${actualFiles.length} route files / ${expectedEntries.length} route-method entries|\\*\\*Inventory:\\*\\* ${actualFiles.length} route files / ${expectedEntries.length} route-method entries`))
console.log(`API authorization inventory contract passed (${actualFiles.length} files, ${expectedEntries.length} route-method entries).`)
