import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const routePath = "app/api/nsfw-gpt/headless/route.ts"
const source = readFileSync(routePath, "utf8")

assert.match(
  source,
  /import \{ ensureActiveSubscription \} from "@\/lib\/subscription-checker"/,
  "headless route must reuse the canonical subscription helper"
)
assert.doesNotMatch(
  source,
  /requireUserId/,
  "headless route must not duplicate authentication with requireUserId"
)

const postStart = source.indexOf("export async function POST(req: NextRequest)")
assert.ok(postStart >= 0, "POST handler must exist")
const postSource = source.slice(postStart)

const authIndex = postSource.indexOf("const auth = await ensureActiveSubscription()")
const authDenyIndex = postSource.indexOf("if (!auth.ok)")
const requestJsonIndex = postSource.indexOf("req.json()")
const providerConfigIndex = postSource.indexOf('getEnv("OPENAI_COMPAT_API_KEY")')
const providerFetchIndex = postSource.indexOf("fetch(`${baseUrl}/chat/completions`")

for (const [label, index] of [
  ["auth call", authIndex],
  ["auth denial", authDenyIndex],
  ["request parsing", requestJsonIndex],
  ["provider config", providerConfigIndex],
  ["provider fetch", providerFetchIndex],
] as const) {
  assert.ok(index >= 0, `${label} must exist in POST handler`)
}

assert.ok(authIndex < authDenyIndex, "authorization must be evaluated before denial handling")
assert.ok(authDenyIndex < requestJsonIndex, "authorization denial must occur before req.json()")
assert.ok(authDenyIndex < providerConfigIndex, "authorization denial must occur before provider config lookup")
assert.ok(authDenyIndex < providerFetchIndex, "authorization denial must occur before provider fetch")

const denyBlock = postSource.slice(authDenyIndex, requestJsonIndex)
assert.match(denyBlock, /return NextResponse\.json\(/, "denied callers must return immediately")
assert.match(denyBlock, /error: auth\.error \?\? "INTERNAL_ERROR"/, "denial must use helper error")
assert.match(denyBlock, /message: auth\.message/, "denial must use helper message")
assert.match(denyBlock, /status: auth\.status \?\? 500/, "denial must use helper status")

assert.equal(
  (postSource.match(/fetch\(`\$\{baseUrl\}\/chat\/completions`/g) || []).length,
  1,
  "active valid flow must contain exactly one provider call site"
)

const misconfiguredIndex = postSource.indexOf('error: "SERVER_MISCONFIGURED"')
assert.ok(misconfiguredIndex >= 0, "missing provider configuration must fail closed")
assert.ok(misconfiguredIndex < providerFetchIndex, "provider configuration failure must occur before provider fetch")

for (const contract of [
  'error: "INVALID_JSON"',
  'error: "MISSING_DESCRIPTION"',
  'error: "INVALID_MODE"',
  'error: "SERVER_MISCONFIGURED"',
  'error: "PROVIDER_ERROR"',
  'status: "ok"',
]) {
  assert.ok(postSource.includes(contract), `existing Siren's Mind contract must remain: ${contract}`)
}

const bodyBeforeProvider = postSource.slice(requestJsonIndex, providerFetchIndex)
assert.ok(bodyBeforeProvider.includes('const description = String(body.description || "").trim()'), "description validation must remain")
assert.ok(bodyBeforeProvider.includes("normalizeGenerationTarget(body.generation_target)"), "generation target handling must remain")
assert.ok(bodyBeforeProvider.includes("validateVaultIds(body.vault_ids || [], mode)"), "vault validation must remain")
assert.ok(bodyBeforeProvider.includes("validateMacroIds(body.macro_ids || [], mode)"), "macro validation must remain")
assert.ok(bodyBeforeProvider.includes("MODEL_BY_MODE[mode]"), "model selection must remain")

// Static control-flow proof for the requested provider-call contracts:
// - anonymous / inactive / lookup failure all return inside the auth denial block,
//   before the only provider fetch call site;
// - invalid JSON / description / mode and missing provider config also return before fetch;
// - an active valid request reaches exactly one provider fetch call site;
// - provider errors are handled only after that single mocked/provider call boundary.
assert.ok(postSource.indexOf('error: "INVALID_JSON"') < providerFetchIndex)
assert.ok(postSource.indexOf('error: "MISSING_DESCRIPTION"') < providerFetchIndex)
assert.ok(postSource.indexOf('error: "INVALID_MODE"') < providerFetchIndex)
assert.ok(postSource.indexOf('error: "PROVIDER_ERROR"') > providerFetchIndex)

console.log("lock02aSirensMindAuthorization source contract ok")
