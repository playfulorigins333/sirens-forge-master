import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { createHash } from "node:crypto"
import {
  attachGeneratedMediaToCreatorPackage,
  GeneratedMediaError,
} from "../../../lib/creator-publishing-queue/media/generatedMediaCore"

const creatorId = "11111111-1111-4111-8111-111111111111"
const profileId = "11111111-1111-4111-8111-111111111112"
const packageId = "11111111-1111-4111-8111-111111111113"
const generationId = "11111111-1111-4111-8111-111111111114"
const bytes = Buffer.from([0x89, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
const sha256 = createHash("sha256").update(bytes).digest("hex")

function fanvueAdmin(overrides: { approved?: boolean; activeTask?: boolean } = {}) {
  const calls: any = { packageFilters: [], rpcs: [], uploads: [] }
  const admin: any = {
    storage: {
      from() {
        return {
          upload(path: string, body: Buffer, options: any) {
            calls.uploads.push({ path, body, options })
            return Promise.resolve({ data: {}, error: null })
          },
          download() {
            return Promise.resolve({ data: new Blob([bytes]), error: null })
          },
          info() {
            return Promise.resolve({ data: { contentType: "image/png", size: bytes.length }, error: null })
          },
        }
      },
    },
    rpc(name: string, args: any) {
      calls.rpcs.push({ name, args })
      return Promise.resolve({ data: { media_asset: { id: "asset-1" }, idempotent: false }, error: null })
    },
    from(table: string) {
      const filters: any[] = []
      const query: any = {
        select() { return query },
        eq(key: string, value: any) {
          filters.push(["eq", key, value])
          if (table === "creator_publishing_content_packages") calls.packageFilters.push(["eq", key, value])
          return query
        },
        neq(key: string, value: any) {
          filters.push(["neq", key, value])
          if (table === "creator_publishing_content_packages") calls.packageFilters.push(["neq", key, value])
          return query
        },
        in(key: string, value: any[]) { filters.push(["in", key, value]); return query },
        order() { return query },
        limit() {
          if (table === "creator_publishing_queue_tasks") {
            return Promise.resolve({ data: overrides.activeTask ? [{ id: "task-1", status: "pending" }] : [], error: null })
          }
          return Promise.resolve({ data: [], error: null })
        },
        maybeSingle() {
          if (table === "creator_publishing_content_packages") {
            return Promise.resolve({
              data: {
                id: packageId,
                creator_id: creatorId,
                target_platform: "fanvue",
                creator_approval_status: overrides.approved ? "approved" : "pending",
              },
              error: null,
            })
          }
          if (table === "generations") {
            const owners = filters.find((entry) => entry[0] === "in" && entry[1] === "user_id")?.[2] ?? []
            return Promise.resolve({
              data: owners.includes(creatorId)
                ? {
                    id: generationId,
                    user_id: creatorId,
                    status: "completed",
                    prompt: "fixture",
                    image_url: "/api/generated-output/fixture",
                    mode: "standard",
                    body_type: "body_feminine",
                    job_type: "image",
                    created_at: "2026-08-17T00:00:00Z",
                    r2_bucket: "private-generations",
                    r2_key: "creator/fixture.png",
                    metadata: { placeholder: false, output_url: "/api/generated-output/fixture" },
                  }
                : null,
              error: null,
            })
          }
          if (table === "creator_publishing_media_assets") return Promise.resolve({ data: null, error: null })
          return Promise.resolve({ data: null, error: null })
        },
      }
      return query
    },
  }
  return { admin, calls }
}

async function attach(overrides: { approved?: boolean; activeTask?: boolean } = {}) {
  const mock = fanvueAdmin(overrides)
  const result = await attachGeneratedMediaToCreatorPackage(
    { contentPackageId: packageId, generationId },
    {
      admin: mock.admin,
      getCreatorIdentity: async () => ({ authUserId: creatorId, profileId }),
      r2Get: async () => ({ body: bytes, contentType: "image/png", contentLength: bytes.length }),
    },
  )
  return { result, calls: mock.calls }
}

test("owned unlocked Fanvue package can attach eligible generated media without a platform bypass", async () => {
  const { result, calls } = await attach()
  assert.equal(result.ok, true)
  assert.deepEqual(calls.packageFilters, [["eq", "id", packageId], ["eq", "creator_id", creatorId]])
  assert.equal(calls.packageFilters.some((entry: any[]) => entry[0] === "neq" && entry[1] === "target_platform"), false)
  assert.equal(calls.rpcs.at(-1).name, "creator_publishing_attach_generated_media")
  assert.equal(calls.rpcs.at(-1).args.p_creator_id, creatorId)
  assert.equal(calls.rpcs.at(-1).args.p_generation_id, generationId)
  assert.equal(calls.rpcs.at(-1).args.p_sha256, sha256)
  assert.equal("target_platform" in calls.rpcs.at(-1).args, false)
  assert.equal("provider" in calls.rpcs.at(-1).args, false)
})

test("approved and active-task Fanvue packages remain locked before association", async () => {
  for (const state of [{ approved: true }, { activeTask: true }]) {
    await assert.rejects(
      () => attach(state),
      (error: unknown) => error instanceof GeneratedMediaError && error.code === "PACKAGE_LOCKED",
    )
  }
})

test("replacement migration preserves authority locks and removes only Fanvue rejection", () => {
  const oldMigration = fs.readFileSync("supabase/migrations/20260710000600_creator_publishing_generated_media_association.sql", "utf8")
  const migration = fs.readFileSync("supabase/migrations/20260817040000_cpq_fanvue_generated_media_attachment.sql", "utf8")
  assert.match(oldMigration, /target_platform = 'fanvue'/)
  assert.doesNotMatch(migration, /target_platform = 'fanvue'/)
  assert.match(migration, /v_package\.creator_id <> p_creator_id/)
  assert.match(migration, /creator_approval_status = 'approved'/)
  assert.match(migration, /status <> 'archived'/)
  assert.match(migration, /security definer/i)
  assert.match(migration, /revoke execute .* from anon/i)
  assert.match(migration, /revoke execute .* from authenticated/i)
  assert.match(migration, /grant execute .* to service_role/i)
  assert.equal((migration.match(/insert into public\.creator_publishing_media_assets/g) ?? []).length, 1)
  assert.equal((migration.match(/insert into public\.creator_publishing_audit_events/g) ?? []).length, 1)
})

test("Fanvue media page is owner-scoped preparation only, not approval or execution", () => {
  const loader = fs.readFileSync("lib/creator-publishing-queue/fanvue/packageMedia.ts", "utf8")
  const page = fs.readFileSync("app/creator/publishing-queue/fanvue/packages/[contentPackageId]/media/page.tsx", "utf8")
  const editor = fs.readFileSync("app/creator/publishing-queue/[contentPackageId]/edit/page.tsx", "utf8")
  assert.match(loader, /requireActiveCreatorPageIdentity/)
  assert.match(loader, /\.eq\("creator_id", creatorId\)/)
  assert.match(loader, /\.eq\("target_platform", "fanvue"\)/)
  assert.match(loader, /generationOwnerIds/)
  assert.match(loader, /isEligibleGeneratedMediaRecord/)
  assert.match(loader, /createCreatorPublishingSignedMediaUrl/)
  assert.match(loader, /generation_assets/)
  assert.match(loader, /generationAssetId/)
  assert.match(loader, /generation_ordinal|ordinal/)
  assert.match(loader, /delivery=redirect/)
  assert.match(loader, /isPrivateCreatorMediaEnabled/)
  assert.match(loader, /creator_approval_status === "approved"/)
  assert.match(loader, /creator_publishing_queue_tasks/)
  assert.doesNotMatch(loader, /access_token|refresh_token|ciphertext|lease_token|provider_post_uuid/)
  assert.match(page, /GeneratedMediaSelectionPanel/)
  assert.match(page, /does not schedule, publish, call Fanvue, or activate public Fanvue posting/)
  assert.doesNotMatch(page, /ApprovalDecisionForm|ComplianceSubmissionPanel|publish_due|schedule_plan|fetch\(/)
  assert.match(editor, /Manage Fanvue package media/)
})

test("asset-level correction migration preserves legacy and permits distinct private outputs",()=>{
  const migration=fs.readFileSync("supabase/migrations/20260824100000_private_generation_asset_publishing.sql","utf8")
  const rollback=fs.readFileSync("supabase/manual/private_generation_asset_publishing_rollback.sql","utf8")
  assert.match(migration,/generation_asset_id/); assert.match(migration,/generation_ordinal/)
  assert.match(migration,/creator_publishing_media_assets_ai_generation_asset_uidx/)
  assert.match(migration,/nullif\(btrim\(ai_generation_metadata->>'generation_asset_id'/)
  assert.match(migration,/p_content_package_id::text\|\|':asset:'\|\|p_generation_asset_id::text/)
  assert.match(rollback,/create unique index creator_publishing_media_assets_ai_generation_uidx/)
})
