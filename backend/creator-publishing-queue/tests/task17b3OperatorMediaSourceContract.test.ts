import assert from "node:assert/strict"
import fs from "node:fs"
import { execFileSync } from "node:child_process"
const read = (p: string) => fs.readFileSync(p, "utf8")
const exists = (p: string) => assert.ok(fs.existsSync(p), `${p} exists`)
const paths = [
"lib/creator-publishing-queue/operator-media/types.ts",
"lib/creator-publishing-queue/operator-media/serviceCore.ts",
"lib/creator-publishing-queue/operator-media/service.ts",
"lib/creator-publishing-queue/operator-media/index.ts",
"app/api/creator-publishing-queue/operator/[platformJobId]/media/[mediaAssetId]/signed-url/route.ts",
"app/creator/publishing-queue/operator/OperatorTaskMedia.tsx",
"backend/creator-publishing-queue/tests/task17b3OperatorMediaAccess.test.ts",
"backend/creator-publishing-queue/tests/task17b3OperatorMediaSourceContract.test.ts",
".github/workflows/task17b3-operator-media.yml",
"app/creator/publishing-queue/operator/[platformJobId]/page.tsx",
".github/workflows/task17b2-operator-ui.yml"]
paths.forEach(exists)
const core = read(paths[1]), service = read(paths[2]), barrel = read(paths[3]), route = read(paths[4]), client = read(paths[5]), page = read(paths[9]), wf2 = read(paths[10]), wf3 = read(paths[8])
assert.ok(service.startsWith('import "server-only"'))
assert.ok(service.includes("const supabase = await supabaseServer()") && service.includes("supabase.auth.getUser()"))
for (const forbidden of ["requireUserId","authenticatedActorId input","DEV_BYPASS_USER_ID","x-dev-user-id","headers()"] ) assert.ok(!service.includes(forbidden))
for (const needed of ["resolveOperatorJobTask","actorCanAccessCreator","isActiveOnlyFansAssistedPreparation"]) assert.ok(core.includes(needed))
assert.ok(!barrel.includes("Deps") && !barrel.includes("Claim") && !barrel.includes("storage_key") && !barrel.includes("claimToken"))
assert.ok(core.includes('exactKeys(r,["platformJobId"]') && core.includes('exactKeys(r,["platformJobId","mediaAssetId","mode"]'))
for (const forbidden of ["creatorId","operatorId","queueTaskId","contentPackageId","platformAccountId","storageKey","claimToken","expiresIn","bucket"]) assert.ok(!route.includes(forbidden), `route does not read ${forbidden}`)
assert.ok(route.includes("getAll(\"mode\").length !== 1") && route.includes("Array.from(url.searchParams.keys()).some"))
assert.ok(core.includes('queueStatus !== "claimed"') && core.includes("row.claimedBy !== deps.actorId") && core.includes("!row.claimedAt") && core.includes("!row.claimToken") && core.includes("!row.claimExpiresAt"))
assert.ok(core.includes("sameContext(initial, final)") && core.includes("a.claimToken===b.claimToken"))
assert.ok(core.includes("ONLYFANS_OPERATOR_MEDIA_ALLOWED_MIME_TYPES = [\"image/jpeg\",\"image/png\",\"image/webp\",\"image/gif\",\"video/mp4\",\"video/webm\"]"))
for (const forbidden of ['startsWith("image/")','startsWith("video/")','image/svg+xml','text/html','application/pdf','application/json']) assert.ok(!core.includes(forbidden))
assert.ok(core.includes("CREATOR_PUBLISHING_MEDIA_SIGNED_URL_EXPIRES_IN_SECONDS") && core.includes("ONLYFANS_OPERATOR_MEDIA_CLAIM_EXPIRY_MARGIN_SECONDS = 5") && core.includes("Math.floor") && core.includes("effectiveExpiresIn > 0"))
for (const forbidden of ["insert(","update(","audit", "console.log", "console.info", "console.warn", "console.error", "router.push", "router.replace"]) assert.ok(!core.includes(forbidden) && !client.includes(forbidden))
assert.ok(client.startsWith('"use client"'))
assert.ok(client.includes("setPreviews") && client.includes("setTimeout") && client.includes("clearPreview(item.mediaAssetId)") && client.includes("clearTimeout") && client.includes("anchor.download") && client.includes('anchor.rel="noopener noreferrer"') && client.includes('anchor.referrerPolicy="no-referrer"') && client.includes("anchor.remove()"))
assert.ok(client.includes("<img") && client.includes('loading="lazy"') && client.includes("<video") && client.includes("controls") && client.includes('preload="metadata"') && client.includes("playsInline"))
for (const forbidden of ["iframe","object","embed","dangerouslySetInnerHTML","caption","storageKey","claimToken"]) assert.ok(!client.includes(forbidden))
assert.ok(route.includes("export async function GET") && route.includes('"Cache-Control":"private, no-store"') && route.includes('Pragma:"no-cache"') && route.includes('"Referrer-Policy":"no-referrer"') && route.includes('"X-Content-Type-Options":"nosniff"'))
assert.ok(!route.includes("redirect") && !route.includes("supabase") && !route.includes("storage") && !route.includes("service_role"))
assert.ok(page.includes("loadOnlyFansOperatorMedia(record.platformJobId)") && page.includes("platformJobId={record.platformJobId}") && page.includes("Claim this task to access its media."))
assert.ok(wf2.includes("TASK17B2_BASE_SHA: 2dd26cd992c305d127e748fe8754aec2b4506431") && wf2.includes("TASK17B2_COMPLETE_SHA: 5ead1e4f6c2da955322d9c1630177f2bc8b3c6f4") && wf2.includes('git diff --name-only "$TASK17B2_BASE_SHA"..."$TASK17B2_COMPLETE_SHA"') && wf2.includes('git merge-base --is-ancestor "$TASK17B2_COMPLETE_SHA" HEAD'))
assert.ok(wf3.includes("BASE_SHA: 5ead1e4f6c2da955322d9c1630177f2bc8b3c6f4") && wf3.includes("wc -l") && wf3.includes("npm run test:creator-publishing-task17b1"))
const changed = Array.from(new Set((execFileSync("git", ["diff","--name-only","5ead1e4f6c2da955322d9c1630177f2bc8b3c6f4...HEAD"], { encoding:"utf8" }) + execFileSync("git", ["diff","--name-only"], { encoding:"utf8" }) + execFileSync("git", ["diff","--cached","--name-only"], { encoding:"utf8" }) + execFileSync("git", ["ls-files","--others","--exclude-standard"], { encoding:"utf8" })).trim().split(/\n/).filter(Boolean).filter(f => f !== "tsconfig.tsbuildinfo" && f !== "next-env.d.ts"))).sort()
assert.deepEqual(changed, [...paths].sort())
const protectedChanged = execFileSync("git", ["diff","--name-only","5ead1e4f6c2da955322d9c1630177f2bc8b3c6f4...HEAD","--","package.json","package-lock.json","supabase/migrations",".github/workflows/task17b1-operator-services.yml","lib/creator-publishing-queue/operator-queue","lib/creator-publishing-queue/media","app/api/creator-publishing-queue/media/[mediaAssetId]/signed-url/route.ts","backend/creator-publishing-queue/tests/mediaAccess.test.ts","app/creator/publishing-queue/operator/OperatorTaskControls.tsx","app/creator/publishing-queue/operator/actions.ts","app/creator/publishing-queue/operator/presentation.ts","app/creator/publishing-queue/operator/page.tsx","backend/creator-publishing-queue/tests/task17b2OperatorQueueUi.test.ts","backend/creator-publishing-queue/tests/task17b2OperatorQueueSourceContract.test.ts"], { encoding:"utf8" }).trim()
assert.equal(protectedChanged, "")
console.log("Task 17B-3 operator media source-contract tests passed")
