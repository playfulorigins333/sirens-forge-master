import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { mock } from "node:test"
const originalFetch = globalThis.fetch
const oldKey = process.env.OPENAI_COMPAT_API_KEY, oldBase = process.env.OPENAI_COMPAT_BASE_URL
process.env.OPENAI_COMPAT_API_KEY = "test"; process.env.OPENAI_COMPAT_BASE_URL = "https://provider.test"
let body: any
mock.module(new URL("../../../lib/subscription-checker.ts", import.meta.url).href, { namedExports: { ensureActiveSubscription: async () => ({ ok: true, user: { id: "owner" } }) } })
globalThis.fetch = async (_input, init) => { body = JSON.parse(String(init?.body)); return Response.json({ choices: [{ message: { content: "polished prompt" } }] }) }
const { POST } = await import(new URL("../../../app/api/nsfw-gpt/headless/route.ts", import.meta.url).href)
const invoke = (extra: object) => POST(new Request("http://test/api/nsfw-gpt/headless", { method: "POST", body: JSON.stringify({ mode: "SAFE", description: "portrait", output_type: "IMAGE", generation_target: "text_to_image", history: [], ...extra }) }) as any)
try {
  const response = await invoke({ vault_ids: ["lighting_environment"], macro_ids: ["macro_detail_amplifier"] })
  assert.equal(response.status, 200)
  const result = await response.json()
  const [vault, macroText] = await Promise.all([readFile("prompts/nsfw_gpt/vaults/lighting_environment.txt", "utf8"), readFile("prompts/nsfw_gpt/macros/macro_detail_amplifier.txt", "utf8")])
  assert.ok(body.messages[0].content.includes(vault.trim())); assert.ok(body.messages[0].content.includes(macroText.trim()))
  assert.deepEqual(result.metadata.missing_vault_files, []); assert.deepEqual(result.metadata.missing_macro_files, [])
  let invalid = await (await invoke({ vault_ids: ["not_real"], macro_ids: [] })).json(); assert.deepEqual(invalid.metadata.invalid_vaults, ["not_real"])
  let blocked = await (await invoke({ vault_ids: ["ultra_extremes_no_limits"], macro_ids: ["macro_intensity_ultra"] })).json()
  assert.deepEqual(blocked.metadata.blocked_vaults, ["ultra_extremes_no_limits"]); assert.deepEqual(blocked.metadata.blocked_macros, ["macro_intensity_ultra"])
  console.log("Phase 6B headless real capability injection: PASS")
} finally {
  globalThis.fetch = originalFetch
  if (oldKey === undefined) delete process.env.OPENAI_COMPAT_API_KEY; else process.env.OPENAI_COMPAT_API_KEY = oldKey
  if (oldBase === undefined) delete process.env.OPENAI_COMPAT_BASE_URL; else process.env.OPENAI_COMPAT_BASE_URL = oldBase
}
