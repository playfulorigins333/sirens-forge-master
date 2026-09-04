import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectImageMime, isPrivateCreatorMediaEnabled, sanitizeDownloadFilename, validateObjectKey } from "../../../lib/private-creator-media/core";
import { parseGenerationSuccess, requirePrivateOutputs } from "../../../lib/generation/upstreamResponse";
import { isPrivateCreatorGenerationOutput, parseCreatorGenerationOutputs } from "../../../lib/generation/clientResponse";

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
  assert.equal(sanitizeDownloadFilename("final movie", "video/mp4"), "final-movie.mp4");
});

test("migration and route preserve server-only least privilege contract", () => {
  const sql = readFileSync("supabase/migrations/20260824090000_private_creator_generation_media.sql", "utf8");
  const route = readFileSync("app/api/library/assets/[assetId]/signed-url/route.ts", "utf8");
  for (const text of ["force row level security", "from public, anon, authenticated", "to service_role", "security definer", "set search_path = pg_catalog, public, pg_temp", "ordinal between 0 and 3", "^[0-9a-f]{64}$"]) assert.ok(sql.toLowerCase().includes(text.toLowerCase()), text);
  assert.match(route, /ensureActiveSubscription/); assert.match(route, /\.eq\("owner_id", auth\.user\.id\)/); assert.match(route, /Cache-Control": "no-store"/); assert.doesNotMatch(route, /NEXT_PUBLIC_.*R2|SERVICE_ROLE_KEY/);
  const privateR2 = readFileSync("lib/private-creator-media/r2.ts", "utf8");
  assert.match(privateR2, /^import "server-only";/);
  for (const name of ["CREATOR_GENERATION_R2_ACCESS_KEY_ID", "CREATOR_GENERATION_R2_SECRET_ACCESS_KEY", "CREATOR_GENERATION_R2_BUCKET"]) assert.match(privateR2, new RegExp(name));
  const privateConfig = readFileSync("lib/private-creator-media/r2Config.ts", "utf8");
  assert.match(privateConfig, /env\.CREATOR_GENERATION_R2_ACCESS_KEY_ID/); assert.match(privateConfig, /env\.CREATOR_GENERATION_R2_SECRET_ACCESS_KEY/);
  assert.doesNotMatch(privateConfig, /env\.R2_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY)/);
  assert.doesNotMatch(privateR2, /process\.env\.R2_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY)/);
  const repositoryText = [privateR2, readFileSync(".env.example", "utf8"), readFileSync("docs/operations/private-creator-media-rollout.md", "utf8")].join("\n");
  assert.doesNotMatch(repositoryText, /NEXT_PUBLIC_CREATOR_GENERATION_R2_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY)/);
  assert.match(repositoryText, /Railway API private credential:[\s\S]*Object Read & Write/);
  assert.match(repositoryText, /Vercel master private credential:[\s\S]*Object Read only/);
});

test("generate response and browser parser preserve asset-level private outputs", () => {
  const generation_id="20000000-0000-4000-8000-000000000001", id="30000000-0000-4000-8000-000000000001";
  const parsed=parseCreatorGenerationOutputs({generation_id,outputs:[{id,generation_id,kind:"image",ordinal:0,private_asset:true}]}); assert.equal(parsed.length,1); assert.equal(isPrivateCreatorGenerationOutput(parsed[0]),true);
  assert.equal(parseCreatorGenerationOutputs({outputs:[{id,generation_id,kind:"image",ordinal:4,private_asset:true}]}).length,0);
  const route=readFileSync("app/api/generate/route.ts","utf8"), page=readFileSync("app/generate/page.tsx","utf8");
  assert.match(route,/private_media_request/); assert.match(route,/creator-generations\/\$\{privateDispatchGenerationId\}\//); assert.match(route,/outputs: finalized\.asset_ids\.map/); assert.match(route,/private_asset: true/);
  assert.match(page,/isPrivateGenerationOutput/); assert.match(page,/generationAssetId/); assert.match(page,/resolveGenerationOutputUrl/); assert.match(page,/signed-url\?mode=preview/);
});

test("schema-absent reads are gated and preview refresh is bounded",()=>{
  const library=readFileSync("app/library/ActiveLibraryPage.tsx","utf8"), loaders=readFileSync("lib/creator-publishing-queue/ui/loaders.ts","utf8"), fanvue=readFileSync("lib/creator-publishing-queue/fanvue/packageMedia.ts","utf8"), client=readFileSync("app/library/LibraryClient.tsx","utf8");
  for(const source of [library,loaders,fanvue]) assert.match(source,/isPrivateCreatorMediaEnabled/);
  assert.match(client,/automaticRefreshes >= 1/); assert.match(client,/Retry preview/); assert.doesNotMatch(client,/onError=\{\(\) => \{ void getPrivateAssetUrl/);
});

test("publishing correction uses asset identity without weakening legacy identity",()=>{
  const migration=readFileSync("supabase/migrations/20260824100000_private_generation_asset_publishing.sql","utf8"), panel=readFileSync("app/creator/publishing-queue/[contentPackageId]/GeneratedMediaSelectionPanel.tsx","utf8");
  assert.match(migration,/generation_asset_id/); assert.match(migration,/generation_ordinal/); assert.match(migration,/creator_publishing_media_assets_ai_generation_asset_uidx/); assert.match(migration,/to service_role/); assert.match(migration,/from public,anon,authenticated/);
  assert.match(panel,/candidate\.candidateId/); assert.match(panel,/generationAssetId/); assert.match(panel,/generationId: candidate\.generationId/);
});

test("always-on CI executes source and disposable PostgreSQL coverage",()=>{
  const frontend=readFileSync(".github/workflows/frontend-launch-readiness.yml","utf8"), postgres=readFileSync(".github/workflows/private-creator-media-postgres.yml","utf8");
  assert.match(frontend,/npm run test:private-creator-media/); assert.match(postgres,/image: postgres:17/); assert.match(postgres,/npm run test:private-creator-media-postgres/); assert.doesNotMatch(postgres,/SUPABASE_SERVICE_ROLE_KEY|production/i);
});

test("private library rows never use legacy image_url fallback", () => {
  const page = readFileSync("app/library/ActiveLibraryPage.tsx", "utf8");
  assert.match(page, /privateGenerationIds/); assert.match(page, /!privateGenerationIds\.has\(row\.id\)/); assert.match(page, /url: null, previewUrl: null, privateAsset: true/);
});

test("Phase 7 application lifecycle fails closed across Library, publishing, video, and purge", () => {
  const activeLibrary = readFileSync("app/library/ActiveLibraryPage.tsx", "utf8");
  const signed = readFileSync("app/api/library/assets/[assetId]/signed-url/route.ts", "utf8");
  const lifecycle = readFileSync("lib/private-creator-media/lifecycle.ts", "utf8");
  const lifecycleRoute = readFileSync("app/api/library/assets/[assetId]/lifecycleRoute.ts", "utf8");
  const publishing = readFileSync("lib/creator-publishing-queue/media/generatedMediaCore.ts", "utf8");
  const publishingFilter = readFileSync("lib/creator-publishing-queue/ui/phase7LifecycleLoaders.ts", "utf8");
  const fanvueFilter = readFileSync("lib/creator-publishing-queue/fanvue/phase7PackageMedia.ts", "utf8");
  const video = readFileSync("lib/video/submission.ts", "utf8");
  const recent = readFileSync("app/library/recently-deleted/RecentlyDeletedClient.tsx", "utf8");
  const manage = readFileSync("app/library/manage/ManagePrivateMediaClient.tsx", "utf8");

  assert.match(activeLibrary, /\.eq\("lifecycle_state", "active"\)/);
  assert.match(signed, /\.in\("lifecycle_state", \["active", "trashed"\]\)/);
  assert.match(lifecycle, /claim_private_generation_asset_purge/);
  assert.match(lifecycle, /sirensApiFetch\("\/internal\/private-media\/purge"/);
  assert.match(lifecycle, /finalize_private_generation_asset_purge/);
  assert.doesNotMatch(lifecycle, /DeleteObjectCommand|CREATOR_GENERATION_R2_SECRET_ACCESS_KEY/);
  assert.match(lifecycleRoute, /ensureActiveSubscription/);
  assert.match(lifecycleRoute, /trashPrivateGenerationAsset/);
  assert.match(lifecycleRoute, /restorePrivateGenerationAsset/);
  assert.match(lifecycleRoute, /purgePrivateGenerationAsset/);
  assert.match(publishing, /lifecycle_state/);
  assert.match(publishing, /lifecycle_state!=="active"/);
  assert.match(publishingFilter, /\.eq\("lifecycle_state", "active"\)/);
  assert.match(fanvueFilter, /\.eq\("lifecycle_state", "active"\)/);
  assert.match(video, /source\.data\.lifecycle_state !== "active"/);
  assert.match(recent, /Retry permanent delete/);
  assert.match(recent, /not claimed complete here/);
  assert.match(manage, /Move to Trash/);
});
