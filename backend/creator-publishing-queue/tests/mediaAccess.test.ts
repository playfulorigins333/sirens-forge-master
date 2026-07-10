import assert from "node:assert/strict"
import fs from "node:fs"
import { execSync } from "node:child_process"
import { createCreatorPublishingSignedMediaUrl, CREATOR_PUBLISHING_MEDIA_DEFAULT_BUCKET, CREATOR_PUBLISHING_MEDIA_SIGNED_URL_EXPIRES_IN_SECONDS, getCreatorPublishingMediaBucket, parseCreatorPublishingMediaAccessMode } from "../../../lib/creator-publishing-queue/media/core"

async function test(name: string, fn: () => void | Promise<void>) { try { await fn(); console.log(`ok - ${name}`) } catch (error) { console.error(`not ok - ${name}`); throw error } }

type MockOptions = { row: any; dbError?: any; signedUrl?: string; signError?: any }
function mockAdmin(options: MockOptions) {
  const calls: any = { filters: [], signed: [], uploads: 0, lists: 0, removes: 0, moves: 0 }
  const query: any = {
    select(v: string) { calls.select = v; return this },
    eq(k: string, v: any) { calls.filters.push(["eq", k, v]); return this },
    neq(k: string, v: any) { calls.filters.push(["neq", k, v]); return this },
    async maybeSingle() { return { data: options.row, error: options.dbError ?? null } },
  }
  const admin: any = {
    from(table: string) { calls.table = table; return query },
    storage: { from(bucket: string) { calls.bucket = bucket; return {
      createSignedUrl(key: string, expires: number, opts?: any) { calls.signed.push({ key, expires, opts }); return { data: options.signedUrl ? { signedUrl: options.signedUrl } : null, error: options.signError ?? (options.signedUrl ? null : { message: "fail" }) } },
      upload() { calls.uploads++; throw new Error("upload forbidden") }, list() { calls.lists++; throw new Error("list forbidden") }, remove() { calls.removes++; throw new Error("remove forbidden") }, move() { calls.moves++; throw new Error("move forbidden") },
    } } },
  }
  return { admin, calls }
}

const ownedRow = { id: "asset-1", storage_key: "creator/pkg/photo.png", mime_type: "image/png", creator_publishing_content_packages: { id: "pkg", creator_id: "creator-1", target_platform: "onlyfans" } }

await test("owned media asset receives a signed preview URL", async () => {
  const { admin, calls } = mockAdmin({ row: ownedRow, signedUrl: "https://signed.example/preview" })
  const result = await createCreatorPublishingSignedMediaUrl({ mediaAssetId: "asset-1", mode: "preview", authenticatedCreatorId: "creator-1" }, { supabaseAdmin: admin })
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.value.signedUrl, "https://signed.example/preview")
  assert.deepEqual(calls.signed[0], { key: "creator/pkg/photo.png", expires: 300, opts: undefined })
})

await test("owned media asset receives a signed download URL", async () => {
  const { admin, calls } = mockAdmin({ row: ownedRow, signedUrl: "https://signed.example/download" })
  const result = await createCreatorPublishingSignedMediaUrl({ mediaAssetId: "asset-1", mode: "download", authenticatedCreatorId: "creator-1" }, { supabaseAdmin: admin })
  assert.equal(result.ok, true)
  assert.equal(calls.signed[0].opts.download, "photo.png")
})

await test("unauthenticated request is rejected", async () => {
  const { admin, calls } = mockAdmin({ row: ownedRow, signedUrl: "https://signed.example" })
  const result = await createCreatorPublishingSignedMediaUrl({ mediaAssetId: "asset-1", mode: "preview" }, { supabaseAdmin: admin, getAuthenticatedCreatorId: async () => null })
  assert.deepEqual(result, { ok: false, status: 401, code: "UNAUTHENTICATED" })
  assert.equal(calls.signed.length, 0)
})

await test("foreign, missing, Fanvue, and blank-key media fail closed before signing", async () => {
  for (const row of [null, { ...ownedRow, storage_key: "" }]) {
    const { admin, calls } = mockAdmin({ row, signedUrl: "https://signed.example" })
    const result = await createCreatorPublishingSignedMediaUrl({ mediaAssetId: "asset-1", mode: "preview", authenticatedCreatorId: "creator-1" }, { supabaseAdmin: admin })
    assert.equal(result.ok, false)
    assert.equal((result as any).status, 404)
    assert.equal(calls.signed.length, 0)
  }
  const source = fs.readFileSync("lib/creator-publishing-queue/media/core.ts", "utf8")
  assert.match(source, /neq\("creator_publishing_content_packages\.target_platform", "fanvue"\)/)
  assert.match(source, /eq\("creator_publishing_content_packages\.creator_id", creatorId\)/)
})

await test("browser input cannot choose bucket, storage key, or expiration", async () => {
  const { admin, calls } = mockAdmin({ row: ownedRow, signedUrl: "https://signed.example" })
  await createCreatorPublishingSignedMediaUrl({ mediaAssetId: "asset-1?bucket=evil&storage_key=evil&expires=99999", mode: "preview", authenticatedCreatorId: "creator-1" }, { supabaseAdmin: admin })
  assert.equal(calls.bucket, CREATOR_PUBLISHING_MEDIA_DEFAULT_BUCKET)
  assert.equal(calls.signed[0].key, ownedRow.storage_key)
  assert.equal(calls.signed[0].expires, CREATOR_PUBLISHING_MEDIA_SIGNED_URL_EXPIRES_IN_SECONDS)
})

await test("default bucket and environment bucket override work", () => {
  assert.equal(getCreatorPublishingMediaBucket({}), "creator-publishing-media")
  assert.equal(getCreatorPublishingMediaBucket({ CREATOR_PUBLISHING_MEDIA_BUCKET: "private-override" }), "private-override")
})

await test("mode parser rejects invalid modes", () => {
  assert.equal(parseCreatorPublishingMediaAccessMode("preview"), "preview")
  assert.equal(parseCreatorPublishingMediaAccessMode("download"), "download")
  assert.equal(parseCreatorPublishingMediaAccessMode("delete"), null)
})

await test("route responses use no-store and send no service-role credential", () => {
  const route = fs.readFileSync("app/api/creator-publishing-queue/media/[mediaAssetId]/signed-url/route.ts", "utf8")
  assert.match(route, /Cache-Control": "no-store"/)
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|service_role/)
})

await test("approval loader uses centralized media service", () => {
  const source = fs.readFileSync("lib/creator-publishing-queue/ui/loaders.ts", "utf8")
  assert.match(source, /createCreatorPublishingSignedMediaUrl/)
  assert.doesNotMatch(source, /createSignedUrl\(storageKey/)
  assert.doesNotMatch(source, /function storageBucket/)
})

await test("no upload, delete, list, move, public bucket, platform calls, or Fanvue autopost changes are introduced", () => {
  const media = fs.readFileSync("lib/creator-publishing-queue/media/core.ts", "utf8")
  assert.doesNotMatch(media, /\.upload\(|\.remove\(|\.list\(|\.move\(|getPublicUrl|public\s*:/)
  assert.doesNotMatch(media, /onlyfans|fansly|fanvue\.com|fetch\(/i)
  const changed = execSync("git diff --name-only", { encoding: "utf8" })
  assert.equal(changed.split(/\n/).filter((p: string) => p.includes("lib/autopost") || p.includes("app/autopost") || p.includes("fanvue") && !p.includes("creator-publishing-queue/tests")).length, 0)
})
