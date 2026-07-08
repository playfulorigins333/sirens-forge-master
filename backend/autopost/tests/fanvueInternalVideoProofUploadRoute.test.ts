import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FANVUE_INTERNAL_VIDEO_PROOF_UPLOAD_CONFIRMATION,
  FANVUE_INTERNAL_VIDEO_PROOF_UPLOAD_MAX_BYTES,
  FANVUE_INTERNAL_VIDEO_PROOF_UPLOAD_OPERATION,
  FANVUE_INTERNAL_VIDEO_PROOF_UPLOAD_ROUTE,
  FANVUE_INTERNAL_VIDEO_PROOF_SEED_SECRET_HEADER,
  handleFanvueInternalVideoProofUploadRoute,
  type FanvueInternalVideoProofSeedResult,
} from "../../../lib/autopost/fanvueInternalVideoProofSeedAsset";

const userId = "879c8a17-f9e8-473d-8de1-1fd1a77c080e";
const secret = "video-upload-secret-never-returned";
const generationId = "623e4567-e89b-42d3-a456-426614174001";
const ruleId = "723e4567-e89b-42d3-a456-426614174001";
const jobId = "823e4567-e89b-42d3-a456-426614174001";

function safeResult(
  overrides: Partial<FanvueInternalVideoProofSeedResult> = {},
): FanvueInternalVideoProofSeedResult {
  return {
    ok: true,
    safe_code: "OK",
    generation_id_present: true,
    generation_id: generationId,
    rule_id_present: true,
    rule_id: ruleId,
    autopost_job_id_present: true,
    autopost_job_id: jobId,
    r2_object_present: true,
    r2_uploaded: true,
    generation_inserted: true,
    generation_reused: false,
    rule_inserted: true,
    rule_reused: false,
    job_inserted: true,
    job_reused: false,
    fanvue_upload_attempted: false,
    fanvue_post_attempted: false,
    dispatch_attempted: false,
    schedule_attempted: false,
    platform_registry_changed: false,
    public_ui_added: false,
    autopost_run_wired: false,
    ...overrides,
  };
}
function mp4(size = 16) {
  return new File([new Uint8Array(size).fill(1)], "proof.mp4", {
    type: "video/mp4",
  });
}
function form(
  overrides: Record<string, FormDataEntryValue> = {},
  file: File | null = mp4(),
) {
  const data = new FormData();
  data.set("operation", FANVUE_INTERNAL_VIDEO_PROOF_UPLOAD_OPERATION);
  data.set("confirm", FANVUE_INTERNAL_VIDEO_PROOF_UPLOAD_CONFIRMATION);
  if (file) data.set("file", file);
  for (const [key, value] of Object.entries(overrides)) data.set(key, value);
  return data;
}
function req(body: BodyInit, headers: HeadersInit = {}, method = "POST") {
  return new Request(
    `https://sirensforge.test${FANVUE_INTERNAL_VIDEO_PROOF_UPLOAD_ROUTE}`,
    {
      method,
      headers: new Headers(headers),
      body: method === "POST" ? body : undefined,
    },
  );
}
async function route(input: Record<string, any> = {}) {
  let createCalls = 0;
  const headers: Record<string, string> = {};
  if (input.requestSecret !== null)
    headers[FANVUE_INTERNAL_VIDEO_PROOF_SEED_SECRET_HEADER] =
      input.requestSecret ?? secret;
  const response = await handleFanvueInternalVideoProofUploadRoute({
    request: req(
      input.body ?? form(input.fields, input.file),
      headers,
      input.method,
    ),
    expectedSecret: secret,
    adminUserIds: userId,
    getAuthenticatedUserId: async () => userId,
    createProofAsset: async ({ userId: routeUserId, source }) => {
      createCalls++;
      assert.equal(routeUserId, userId);
      assert.equal(source.contentType, "video/mp4");
      assert.equal(source.filename.endsWith(".mp4"), true);
      return input.seedResult ?? safeResult();
    },
  });
  return { response, createCalls };
}
function noLeak(value: unknown) {
  assert.doesNotMatch(
    JSON.stringify(value),
    /server-owned-r2-bucket|fanvue\/internal-video-proof-uploads|object-bytes|signed-url|provider-id|fanvue-media-uuid|upload-id|ftyp|mdat|cookie|authorization|bearer|r2_key/i,
  );
}

async function run() {
  const missingSecret = await route({ requestSecret: null });
  assert.equal(missingSecret.response.status, 401);
  assert.equal(
    (missingSecret.response.body as any).safe_code,
    "FANVUE_UPLOAD_DIAGNOSTIC_SECRET_REQUIRED",
  );
  assert.equal(missingSecret.createCalls, 0);

  const invalidSecret = await route({ requestSecret: "bad" });
  assert.equal(invalidSecret.response.status, 403);
  assert.equal(
    (invalidSecret.response.body as any).safe_code,
    "FANVUE_UPLOAD_DIAGNOSTIC_SECRET_INVALID",
  );
  assert.equal(invalidSecret.createCalls, 0);

  for (const key of [
    "providerUuid",
    "provider_id",
    "uploadId",
    "mediaUuid",
    "fanvueMediaUuid",
    "providerPayload",
    "url",
    "signed_url",
    "cookie",
    "authorization",
  ]) {
    const result = await route({ fields: { [key]: "caller-supplied" } });
    assert.equal(result.response.status, 400, key);
    assert.equal(
      (result.response.body as any).safe_code,
      "CALLER_SUPPLIED_FORBIDDEN_FIELD",
      key,
    );
    assert.equal(result.createCalls, 0, key);
  }

  const badType = await route({
    file: new File([new Uint8Array([1])], "proof.mp4", {
      type: "video/quicktime",
    }),
  });
  assert.equal(
    (badType.response.body as any).safe_code,
    "INVALID_CONTENT_TYPE",
  );
  const badExt = await route({
    file: new File([new Uint8Array([1])], "proof.mov", { type: "video/mp4" }),
  });
  assert.equal(
    (badExt.response.body as any).safe_code,
    "INVALID_FILE_EXTENSION",
  );
  const hugeFile = new File(
    [new Uint8Array(FANVUE_INTERNAL_VIDEO_PROOF_UPLOAD_MAX_BYTES + 1)],
    "proof.mp4",
    { type: "video/mp4" },
  );
  const huge = await route({ file: hugeFile });
  assert.equal((huge.response.body as any).safe_code, "FILE_TOO_LARGE");
  assert.equal(huge.createCalls, 0);

  const success = await route();
  assert.equal(success.response.status, 200);
  assert.equal((success.response.body as any).ok, true);
  assert.equal((success.response.body as any).fanvue_upload_attempted, false);
  assert.equal((success.response.body as any).fanvue_post_attempted, false);
  assert.equal((success.response.body as any).dispatch_attempted, false);
  assert.equal((success.response.body as any).schedule_attempted, false);
  assert.equal((success.response.body as any).platform_registry_changed, false);
  assert.equal((success.response.body as any).public_ui_added, false);
  assert.equal((success.response.body as any).autopost_run_wired, false);
  noLeak(success.response.body);

  const routeSource = readFileSync(
    "app/api/admin/autopost/fanvue/internal-video-proof-upload/route.ts",
    "utf8",
  );
  const helperSource = readFileSync(
    "lib/autopost/fanvueInternalVideoProofSeedAsset.ts",
    "utf8",
  );
  assert.doesNotMatch(
    `${routeSource}\n${helperSource}`,
    /createFanvueCreatorUploadSession|createFanvueMediaPost|completeFanvueUploadSession|getFanvueCreatorUploadPartUrl|uploadFanvueSignedPart|waitForFanvueMediaReady|api\/autopost\/run|from [^\n]*platformRegistry|platformRegistry\./i,
  );
  assert.doesNotMatch(
    readFileSync("app/api/autopost/run/route.ts", "utf8"),
    /internal-video-proof-upload|fanvueInternalVideoProofUpload/i,
  );
  assert.doesNotMatch(
    readFileSync("lib/autopost/platformRegistry.ts", "utf8"),
    /internal-video-proof-upload|fanvue_internal_video_proof_upload/i,
  );
}

run()
  .then(() =>
    console.log("Fanvue internal video proof upload route tests passed"),
  )
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
