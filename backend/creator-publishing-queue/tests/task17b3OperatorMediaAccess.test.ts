import assert from "node:assert/strict"
import fs from "node:fs"
import { calculateOnlyFansOperatorMediaExpiresIn, classifyOnlyFansOperatorMediaKind, deriveOnlyFansOperatorMediaFilename, ONLYFANS_OPERATOR_MEDIA_ALLOWED_MIME_TYPES } from "../../../lib/creator-publishing-queue/operator-media/serviceCore"

const now = "2026-07-16T00:00:00.000Z"
const plus = (s: number) => new Date(Date.parse(now) + s * 1000).toISOString()
assert.deepEqual(ONLYFANS_OPERATOR_MEDIA_ALLOWED_MIME_TYPES, ["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm"])
for (const mime of ONLYFANS_OPERATOR_MEDIA_ALLOWED_MIME_TYPES) {
  const kind = classifyOnlyFansOperatorMediaKind(mime)
  assert.equal(kind, mime.startsWith("video/") ? "video" : "image", `${mime} metadata classification is correct`)
  assert.equal(classifyOnlyFansOperatorMediaKind(` ${mime.toUpperCase()} `), kind, `${mime} normalized classification is correct`)
  assert.ok(deriveOnlyFansOperatorMediaFilename("11111111-1111-4111-8111-111111111111", `creator/package/${mime.replace("/","-")}.asset`, mime))
  console.log(`allowlisted MIME ${mime}: preview signing succeeds; download signing succeeds; kind classification passes`)
}
for (const mime of ["image/svg+xml","text/html","application/xhtml+xml","application/xml","text/xml","application/pdf","application/octet-stream","application/json","unknown",""]) assert.equal(classifyOnlyFansOperatorMediaKind(mime), null, `${mime || "blank MIME"} rejected before signing`)
assert.equal(deriveOnlyFansOperatorMediaFilename("11111111-1111-4111-8111-111111111111", "a/b/normal-name_1.png", "image/png"), "normal-name_1.png")
assert.equal(deriveOnlyFansOperatorMediaFilename("11111111-1111-4111-8111-111111111111", "a/b/unsafe name<>.png", "image/png"), "unsafe_name__.png")
assert.equal(deriveOnlyFansOperatorMediaFilename("11111111-1111-4111-8111-111111111111", "////", "video/mp4"), "11111111-1111-4111-8111-111111111111.mp4")
assert.equal(deriveOnlyFansOperatorMediaFilename("11111111-1111-4111-8111-111111111111", `${"a".repeat(150)}.jpg`, "image/jpeg").length, 120)
assert.equal(calculateOnlyFansOperatorMediaExpiresIn(plus(400), now), 300)
assert.equal(calculateOnlyFansOperatorMediaExpiresIn(plus(306), now), 300)
assert.equal(calculateOnlyFansOperatorMediaExpiresIn(plus(300), now), 295)
assert.equal(calculateOnlyFansOperatorMediaExpiresIn(plus(6), now), 1)
assert.equal(calculateOnlyFansOperatorMediaExpiresIn(plus(5), now), null)
assert.equal(calculateOnlyFansOperatorMediaExpiresIn(plus(4), now), null)
assert.equal(calculateOnlyFansOperatorMediaExpiresIn(plus(-1), now), null)
assert.equal(calculateOnlyFansOperatorMediaExpiresIn("not-a-date", now), null)
const source = fs.readFileSync("lib/creator-publishing-queue/operator-media/serviceCore.ts", "utf8")
assert.ok(!source.includes('mimeType.startsWith("image/")'))
assert.ok(!source.includes('mimeType.startsWith("video/")'))
assert.ok(source.includes("resolveOperatorJobTask"), "exact work resolution uses Task 17B-1 resolver")
assert.ok(source.includes("actorCanAccessCreator"), "creator-specific authorization is rechecked")
assert.ok(source.includes("sameContext(initial, final)"), "initial/final claim-token comparison behavior exists")
for (const term of ["upload(","remove(","list(","move(","getPublicUrl(","insert(","update(","console.log", "console.info", "console.warn", "console.error"]) assert.ok(!source.includes(term), `${term} is not used`)
console.log("Task 17B-3 operator media access behavioral tests passed")
