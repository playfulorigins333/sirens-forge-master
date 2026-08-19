import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const root = process.cwd()
const apiRoot = path.join(root, "app/api")
const inventoryPath = path.join(root, "docs/security/api-authorization-inventory.md")
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const
const allowedTaxonomy = new Set(["PUBLIC", "AUTHENTICATED", "OWNER", "ENTITLED", "ADMIN", "SCHEDULER_SECRET", "WEBHOOK_SIGNATURE", "OAUTH_CALLBACK", "INTERNAL_CONTROLLED"])
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

const markdown = await readFile(inventoryPath, "utf8")
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

assert.match(markdown, new RegExp(`\\*\\*Inventory:\\*\\* ${actualFiles.length} route files / ${expectedEntries.length} route-method entries`))
console.log(`API authorization inventory contract passed (${actualFiles.length} files, ${expectedEntries.length} route-method entries).`)
