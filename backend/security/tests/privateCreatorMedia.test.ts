import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectImageMime, isPrivateCreatorMediaEnabled, sanitizeDownloadFilename, validateObjectKey } from "../../../lib/private-creator-media/core";
import { parseGenerationSuccess, requirePrivateOutputs } from "../../../lib/generation/upstreamResponse";

test("private media gate enables only for exact lowercase true", () => {
  for (const value of [undefined, "", "false", "TRUE", "True", "1"]) assert.equal(isPrivateCreatorMediaEnabled({ PRIVATE_CREATOR_MEDIA_ENABLED: value } as NodeJS.ProcessEnv), false);
  assert.equal(isPrivateCreatorMediaEnabled({ PRIVATE_CREATOR_MEDIA_ENABLED: "true" } as NodeJS.ProcessEnv), true);
});

test("upstream contract accepts one through four storage-only image outputs and rejects malformed sets", () => {
  for (let count = 1; count <= 4; count += 1) {
    const parsed = parseGenerationSuccess({ success: true, outputs: Array.from({ length: count }, (_, i) => ({ kind: "image", r2_bucket: "private-media", r2_key: `creator/a/${i}.png` })) });
    assert.ok(parsed); assert.equal(requirePrivateOutputs(parsed).length, count);
  }
  assert.equal(parseGenerationSuccess({ success: true, outputs: Array.from({ length: 5 }, (_, i) => ({ kind: "image", r2_bucket: "b", r2_key: `${i}` })) }), null);
  for (const output of [{kind:"video",r2_bucket:"b",r2_key:"k"},{kind:"image",r2_bucket:"",r2_key:"k"},{kind:"image",r2_bucket:"b",r2_key:""},{kind:"image"}]) assert.equal(parseGenerationSuccess({success:true,outputs:[output]}),null);
  assert.ok(parseGenerationSuccess({ success: true, image_url: "https://legacy.example/image.png" }));
});

test("keys, image signatures, and filenames fail closed", () => {
  assert.equal(validateObjectKey("creator/id/output.png"), "creator/id/output.png");
  for (const key of ["", "/absolute", "a//b", "a/../b", "a\\b", "a\0b"]) assert.throws(() => validateObjectKey(key));
  assert.equal(detectImageMime(Buffer.from([0xff,0xd8,0xff,0xe0])), "image/jpeg");
  assert.equal(detectImageMime(Buffer.from([137,80,78,71,13,10,26,10])), "image/png");
  assert.equal(detectImageMime(Buffer.from("RIFF0000WEBP")), "image/webp");
  assert.equal(detectImageMime(Buffer.from("not media")), null);
  assert.equal(sanitizeDownloadFilename("../../ private prompt", "image/png"), "private-prompt.png");
});

test("migration and route preserve server-only least privilege contract", () => {
  const sql = readFileSync("supabase/migrations/20260824090000_private_creator_generation_media.sql", "utf8");
  const route = readFileSync("app/api/library/assets/[assetId]/signed-url/route.ts", "utf8");
  for (const text of ["force row level security", "from public, anon, authenticated", "to service_role", "security definer", "set search_path = pg_catalog, public, pg_temp", "ordinal between 0 and 3", "^[0-9a-f]{64}$"]) assert.ok(sql.toLowerCase().includes(text.toLowerCase()), text);
  assert.match(route, /ensureActiveSubscription/); assert.match(route, /\.eq\("owner_id", auth\.user\.id\)/); assert.match(route, /Cache-Control": "no-store"/); assert.doesNotMatch(route, /NEXT_PUBLIC_.*R2|SERVICE_ROLE_KEY/);
});

test("private library rows never use legacy image_url fallback", () => {
  const page = readFileSync("app/library/page.tsx", "utf8");
  assert.match(page, /privateGenerationIds/); assert.match(page, /!privateGenerationIds\.has\(row\.id\)/); assert.match(page, /url: null,[\s\S]*previewUrl: null,[\s\S]*privateAsset: true/);
});
