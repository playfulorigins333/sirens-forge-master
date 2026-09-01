import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { test } from "node:test"
import { VAULT_DEFS, listVaultsForMode, validateVaultIds } from "../../../prompts/nsfw_gpt/vault_registry"
import { MACROS, listMacrosForMode, validateMacroIds } from "../../../prompts/nsfw_gpt/macro_registry"
import { buildCapabilityCatalog } from "../../../lib/sirens-mind/capabilities"
import { identityDataMessage, MAX_IDENTITY_DATA_CHARS, usableOwnedIdentities } from "../../../lib/sirens-mind/identities"

const root = process.cwd()
const file = (kind: string, id: string) => readFileSync(`${root}/prompts/nsfw_gpt/${kind}/${id}.txt`, "utf8")
test("canonical Vault and Macro registries have exact nonempty assets", () => {
  assert.equal(VAULT_DEFS.length, 30)
  for (const item of VAULT_DEFS) assert.ok(file("vaults", item.id).trim(), item.id)
  for (const item of MACROS) assert.ok(file("macros", item.id).trim(), item.id)
  assert.deepEqual(readdirSync(`${root}/prompts/nsfw_gpt/macros`).filter(x => x.endsWith(".txt")).sort(), MACROS.map(x => `${x.id}.txt`).sort())
  assert.equal(validateVaultIds(["lighting_environment"], "SAFE").ok, true)
  assert.deepEqual(validateVaultIds(["ultra_extremes_no_limits"], "SAFE").blocked_ids, ["ultra_extremes_no_limits"])
  assert.deepEqual(validateVaultIds(["not_real"], "ULTRA").invalid_ids, ["not_real"])
  assert.deepEqual(validateMacroIds(["macro_detail_amplifier"], "SAFE").macro_ids, ["macro_detail_amplifier"])
  assert.deepEqual(validateMacroIds(["macro_intensity_ultra"], "SAFE").blocked_ids, ["macro_intensity_ultra"])
  assert.deepEqual(validateMacroIds(["not_real"], "ULTRA").invalid_ids, ["not_real"])
})
test("catalog contains real recipes only within the selected mode", () => {
  const safe = buildCapabilityCatalog("SAFE"), nsfw = buildCapabilityCatalog("NSFW"), ultra = buildCapabilityCatalog("ULTRA")
  const safeText = file("vaults", "lighting_environment").trim()
  const nsfwText = file("macros", "macro_escalation_pressure").trim()
  const ultraText = file("macros", "macro_taboo_amplifier_ultra").trim()
  assert.ok(safe.includes(safeText)); assert.ok(!safe.includes(nsfwText)); assert.ok(!safe.includes(ultraText))
  assert.ok(nsfw.includes(safeText)); assert.ok(nsfw.includes(nsfwText)); assert.ok(!nsfw.includes(ultraText))
  assert.ok(ultra.includes(safeText)); assert.ok(ultra.includes(nsfwText)); assert.ok(ultra.includes(ultraText))
  assert.ok(listVaultsForMode("SAFE").every(x => x.minMode === "SAFE"))
  assert.ok(listMacrosForMode("SAFE").every(x => x.minMode === "SAFE"))
})
test("single authority and browser/server identity boundaries remain explicit", () => {
  const route = readFileSync(`${root}/app/api/sirens-mind/chat/route.ts`, "utf8")
  const chat = readFileSync(`${root}/components/chat/ChatUI.tsx`, "utf8")
  const identity = readFileSync(`${root}/lib/sirens-mind/identities.ts`, "utf8")
  assert.ok(!readdirSync(`${root}/prompts/nsfw_gpt`).includes("vault_capabilities.ts"))
  assert.doesNotMatch(chat, /vault_ids|macro_ids/)
  assert.match(chat, /identity: msg\.meta\.identityId \|\| undefined/)
  assert.doesNotMatch(chat, /identity: initialIdentity/)
  assert.match(route, /ensureActiveSubscription\(\)/)
  assert.match(route, /loadOwnedIdentities\(auth\.user\.id\)/)
  assert.doesNotMatch(identity, /getSupabaseAdmin|service_role/)
  assert.match(identity, /select\("id,name,description,artifact_r2_bucket,artifact_r2_key,trigger_token"\)/)
  assert.match(route, /CAPABILITY_CATALOG_UNAVAILABLE/)
})
test("usable identities exclude blank artifacts and model data remains complete", () => {
  const good = { id: "10000000-0000-4000-8000-000000000001", name: "Active", description: "x".repeat(500), artifact_r2_bucket: "b", artifact_r2_key: "k", trigger_token: "t" }
  const rows = [good, { ...good, id: "10000000-0000-4000-8000-000000000002", artifact_r2_bucket: "" }, { ...good, id: "10000000-0000-4000-8000-000000000003", artifact_r2_key: "   " }, { ...good, id: "10000000-0000-4000-8000-000000000004", trigger_token: "" }]
  assert.deepEqual(usableOwnedIdentities(rows).map(x => x.id), [good.id])
  const many = Array.from({ length: 50 }, (_, i) => ({ id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, name: "n".repeat(120), description: "d".repeat(500) }))
  const active = many.at(-1)!.id
  const message = identityDataMessage(many, active)
  const serialized = message.split("\n")[1]
  assert.ok(message.length <= MAX_IDENTITY_DATA_CHARS)
  const parsed = JSON.parse(serialized)
  assert.equal(parsed.active_identity_id, active); assert.ok(parsed.identities.some((x: any) => x.id === active))
  assert.ok(parsed.identities.every((x: any) => x.name.length === 120 && x.description.length === 500))
})
