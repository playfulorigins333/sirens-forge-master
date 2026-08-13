import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const enabledRoutes = [
  "app/api/lora/create/route.ts",
  "app/api/lora/get-upload-urls/route.ts",
  "app/api/lora/status/route.ts",
  "app/api/lora/train/route.ts",
]

for (const path of enabledRoutes) {
  const source = await readFile(path, "utf8")
  const entitlement = source.indexOf("const auth = await ensureActiveSubscription()")
  const identity = source.indexOf("const userId = auth.user.id")
  const admin = source.indexOf("getSupabaseAdmin()")

  assert.notEqual(entitlement, -1, `${path} must enforce paid entitlement`)
  assert.match(source, /if \(!auth\.ok\)/, `${path} must fail closed`)
  assert.ok(identity > entitlement, `${path} must use the entitled server identity`)
  assert.ok(admin > identity, `${path} must not initialize privileged database access before entitlement`)
  assert.doesNotMatch(source, /requireUserId/, `${path} must not use the authentication-only boundary`)
}

const upload = await readFile("app/api/lora/get-upload-urls/route.ts", "utf8")
const uploadEntitlement = upload.indexOf("const auth = await ensureActiveSubscription()")
for (const privilegedOperation of [
  '.from("dataset_doctor_jobs")',
  "new ListObjectsV2Command",
  "new DeleteObjectCommand",
  "await getSignedUrl",
]) {
  assert.ok(
    upload.indexOf(privilegedOperation) > uploadEntitlement,
    `${privilegedOperation} must occur after entitlement`,
  )
}
assert.ok(upload.indexOf('if (lora.user_id !== userId)') < upload.indexOf('.from("dataset_doctor_jobs")'))

const status = await readFile("app/api/lora/status/route.ts", "utf8")
assert.match(status, /if \(data\.user_id !== userId\)/)

const train = await readFile("app/api/lora/train/route.ts", "utf8")
assert.match(train, /if \(lora\.user_id !== userId\)/)
assert.ok(train.indexOf('status: "queued"') > train.indexOf("const auth = await ensureActiveSubscription()"))

const proxy = await readFile("lib/datasetDoctorProxy.ts", "utf8")
const proxyEntitlement = proxy.indexOf("const auth = await ensureActiveSubscription()")
const proxyOwnership = proxy.indexOf('.eq("user_id", userId)')
const proxyUpstream = proxy.indexOf("await sirensApiFetch(")
assert.ok(proxyEntitlement >= 0)
assert.ok(proxyOwnership > proxyEntitlement)
assert.ok(proxyUpstream > proxyOwnership)
assert.doesNotMatch(proxy, /requireUserId/)

for (const path of [
  "app/api/lora/start-training/route.ts",
  "app/api/lora/upload-dataset/route.ts",
]) {
  const source = await readFile(path, "utf8")
  assert.match(source, /LEGACY_LORA_ENDPOINT_DISABLED/)
  assert.match(source, /status: 410/)
}

console.log("LoRA paid-entitlement parity source contract ok")
