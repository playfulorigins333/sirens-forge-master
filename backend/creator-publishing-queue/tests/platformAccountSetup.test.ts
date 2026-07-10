import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import { normalizeAccountInput, normalizeProfileUrl, normalizeUsername } from "../../../lib/creator-publishing-queue/accounts/validation"
import { saveCreatorPlatformAccountWithDeps } from "../../../lib/creator-publishing-queue/accounts/serviceCore"

const migrationPath = "supabase/migrations/20260710000700_creator_publishing_platform_account_setup.sql"
const migration = fs.readFileSync(migrationPath, "utf8")

test("migration source removes direct browser writes and adds service-role-only RPC", () => {
  assert.deepEqual(fs.readdirSync("supabase/migrations").filter(f => f.includes("platform_account_setup")), ["20260710000700_creator_publishing_platform_account_setup.sql"])
  assert.match(migration, /drop policy if exists "creator_platform_accounts_insert_own"/)
  assert.match(migration, /drop policy if exists "creator_platform_accounts_update_own"/)
  assert.match(fs.readFileSync("supabase/migrations/20260710000100_creator_publishing_queue_foundation.sql", "utf8"), /creator_platform_accounts_select_own/) 
  assert.match(migration, /security definer/i)
  assert.match(migration, /set search_path = public, pg_temp/i)
  assert.match(migration, /p_account_id is null[\s\S]*insert into public\.creator_platform_accounts/)
  assert.match(migration, /where id = p_account_id for update/)
  assert.match(migration, /v_existing\.creator_id <> p_creator_id/) 
  assert.match(migration, /fanvue[\s\S]*FANVUE_NOT_AVAILABLE/)
  assert.match(migration, /not in \('onlyfans','fansly'\)/)
  assert.match(migration, /v_existing\.platform <> v_platform/)
  assert.match(migration, /v_username text := btrim/) 
  assert.match(migration, /verification_status = v_status/)
  assert.match(migration, /verification_attested_at = v_attested_at/)
  assert.match(migration, /returning \* into v_result/g)
  assert.match(migration, /insert into public\.creator_publishing_audit_events/) 
  assert.match(migration, /on conflict[\s\S]*do nothing/) 
  assert.match(migration, /revoke execute .* from public/i)
  assert.match(migration, /revoke execute .* from anon/i)
  assert.match(migration, /revoke execute .* from authenticated/i)
  assert.match(migration, /grant execute .* to service_role/i)
})

test("validation accepts only OnlyFans and Fansly and normalizes usernames", () => {
  assert.equal(normalizeAccountInput({ platform: "onlyfans", platformUsername: " creator ", idempotencyKey: "abc12345" }).platformUsername, "creator")
  assert.equal(normalizeAccountInput({ platform: "fansly", platformUsername: "creator", idempotencyKey: "abc12345" }).platform, "fansly")
  assert.throws(() => normalizeAccountInput({ platform: "fanvue", platformUsername: "creator", idempotencyKey: "abc12345" }), /Fanvue/)
  assert.throws(() => normalizeUsername("   "), /required/)
  assert.throws(() => normalizeUsername("a".repeat(81)), /too long/)
})

test("profile URL validation is local-only and rejects unsafe references", () => {
  const originalFetch = (globalThis as any).fetch
  ;(globalThis as any).fetch = () => { throw new Error("network call forbidden") }
  try {
    assert.equal(normalizeProfileUrl("", "onlyfans"), null)
    assert.equal(normalizeProfileUrl("https://onlyfans.com/name", "onlyfans"), "https://onlyfans.com/name")
    assert.equal(normalizeProfileUrl("https://www.fansly.com/name", "fansly"), "https://www.fansly.com/name")
    for (const bad of ["http://onlyfans.com/name", "https://example.com/name", "https://user:pass@onlyfans.com/name", "javascript:alert(1)", "data:text/plain,hi", "https://localhost/name", "https://127.0.0.1/name", "not a url", "https://onlyfans.com/name#token=abc"]) assert.throws(() => normalizeProfileUrl(bad, "onlyfans"))
  } finally { ;(globalThis as any).fetch = originalFetch }
})

test("service derives creator id, calls RPC, maps safe errors, and rejects browser credentials", async () => {
  const calls: any[] = []
  const deps = { getAuthenticatedUserId: async () => "creator-1", randomUUID: () => "idem_12345", getAdminClient: () => ({ rpc: async (name: string, args: any) => { calls.push({ name, args }); return { data: { id: "acc", platform: "onlyfans", platform_username: args.p_platform_username, profile_url: null, is_virtual_entity: false, verification_status: args.p_creator_attested ? "creator_attested" : "unattested", verification_attested_at: args.p_creator_attested ? "2026-07-10T00:00:00Z" : null }, error: null } }, from: () => ({}) }) }
  assert.equal((await saveCreatorPlatformAccountWithDeps({ platform: "onlyfans", platformUsername: "me", creatorAttested: true, idempotencyKey: "idem_12345", creatorId: "browser" as any }, deps as any)).ok, false)
  const created = await saveCreatorPlatformAccountWithDeps({ platform: "onlyfans", platformUsername: " me ", creatorAttested: true, idempotencyKey: "idem_12345" }, deps as any)
  assert.equal(created.ok, true)
  assert.equal(calls[0].args.p_creator_id, "creator-1")
  assert.equal(calls[0].args.p_platform_username, "me")
  assert.equal(JSON.stringify(created).includes("service_role"), false)
  assert.equal(JSON.stringify(calls).includes("password"), false)
  assert.equal((await saveCreatorPlatformAccountWithDeps({ platform: "fanvue", platformUsername: "me", idempotencyKey: "idem_12345" }, deps as any)).ok, false)
  assert.equal((await saveCreatorPlatformAccountWithDeps({ platform: "onlyfans", platformUsername: "me", password: "x" as any, idempotencyKey: "idem_12345" }, deps as any)).ok, false)
  assert.equal((await saveCreatorPlatformAccountWithDeps({ platform: "onlyfans", platformUsername: "me", idempotencyKey: "idem_12345" }, { ...deps, getAuthenticatedUserId: async () => null } as any)).ok, false)
  assert.equal((await saveCreatorPlatformAccountWithDeps({ accountId: "00000000-0000-0000-0000-000000000000", platform: "fansly", platformUsername: "me", idempotencyKey: "idem_12345" }, { ...deps, getAdminClient: () => ({ rpc: async () => ({ data: null, error: { message: "ACCOUNT_NOT_FOUND" } }), from: () => ({}) }) } as any)).code, "ACCOUNT_NOT_FOUND")
  assert.equal((await saveCreatorPlatformAccountWithDeps({ platform: "onlyfans", platformUsername: "me", idempotencyKey: "idem_12345" }, { ...deps, getAdminClient: () => ({ rpc: async () => ({ data: null, error: { message: "ACCOUNT_REVOKED" } }), from: () => ({}) }) } as any)).code, "ACCOUNT_REVOKED")
})

test("action and UI source assertions enforce safe fields and copy", () => {
  const form = fs.readFileSync("app/creator/publishing-queue/accounts/PlatformAccountForm.tsx", "utf8")
  const page = fs.readFileSync("app/creator/publishing-queue/accounts/page.tsx", "utf8")
  const actions = fs.readFileSync("app/creator/publishing-queue/accounts/actions.ts", "utf8")
  const queue = fs.readFileSync("app/creator/publishing-queue/page.tsx", "utf8")
  assert.match(form, /OnlyFans/); assert.match(form, /Fansly/); assert.doesNotMatch(form, /Fanvue/)
  assert.match(form, /readOnly/); assert.match(form, /platformUsername/); assert.match(form, /profileUrl/); assert.match(form, /isVirtualEntity/); assert.match(form, /creatorAttested/)
  assert.doesNotMatch(form + page, /type="password"|name="token"|name="cookie"|Connect account|Login connected|Test connection|Platform verified|Automatically verified/i)
  assert.match(form + page, /does not store your password, tokens, cookies, or login session/)
  assert.match(page, /Creator attested/); assert.match(page, /Attestation required/)
  assert.match(actions, /revalidatePath\("\/creator\/publishing-queue\/accounts"\)/); assert.match(actions, /revalidatePath\("\/creator\/publishing-queue"\)/)
  assert.match(queue, /Manage platform accounts/)
  assert.doesNotMatch(form, /getSupabaseAdmin|service_role|\.from\("creator_platform_accounts"\)\.(insert|update)/)
})

test("no Fanvue/autopost imports or platform network calls are introduced", () => {
  for (const file of ["lib/creator-publishing-queue/accounts/service.ts", "lib/creator-publishing-queue/accounts/validation.ts", "app/creator/publishing-queue/accounts/actions.ts"]) {
    const source = fs.readFileSync(file, "utf8")
    assert.doesNotMatch(source, /lib\/autopost|backend\/autopost|fanvueAdapter|fetch\(|onlyfans\.com.*fetch|fansly\.com.*fetch/)
  }
})
