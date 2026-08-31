import test from "node:test";
import assert from "node:assert/strict";
import { isPrivateCreatorMediaDeliveryReady, resolvePrivateR2Config } from "../../../lib/private-creator-media/r2Config";

function configured(): NodeJS.ProcessEnv { return { R2_ENDPOINT: "https://account.r2.cloudflarestorage.com", R2_ACCESS_KEY_ID: "legacy-access", R2_SECRET_ACCESS_KEY: "legacy-secret", CREATOR_GENERATION_R2_ACCESS_KEY_ID: "private-access", CREATOR_GENERATION_R2_SECRET_ACCESS_KEY: "private-secret", CREATOR_GENERATION_R2_BUCKET: "private-generations" }; }
test("private config resolves dedicated credentials and bucket", () => { const result=resolvePrivateR2Config(configured()); assert.equal(result.endpoint,"https://account.r2.cloudflarestorage.com/"); assert.deepEqual({accessKeyId:result.accessKeyId,secretAccessKey:result.secretAccessKey},{accessKeyId:"private-access",secretAccessKey:"private-secret"}); assert.notEqual(result.accessKeyId,"legacy-access"); assert.notEqual(result.secretAccessKey,"legacy-secret"); });
for (const missing of ["CREATOR_GENERATION_R2_ACCESS_KEY_ID", "CREATOR_GENERATION_R2_SECRET_ACCESS_KEY"] as const) test(`private config fails closed without ${missing}`,()=>{const env=configured();delete env[missing];assert.throws(()=>resolvePrivateR2Config(env),/PRIVATE_MEDIA_R2_NOT_CONFIGURED/)});
test("generic credentials cannot satisfy private config",()=>{const env=configured();delete env.CREATOR_GENERATION_R2_ACCESS_KEY_ID;delete env.CREATOR_GENERATION_R2_SECRET_ACCESS_KEY;assert.throws(()=>resolvePrivateR2Config(env),/PRIVATE_MEDIA_R2_NOT_CONFIGURED/)});
test("private config is lazy and gate-off-safe at import",()=>{assert.equal(typeof resolvePrivateR2Config,"function")});
test("private delivery readiness requires the exact gate and complete dedicated config", () => {
  const ready = configured(); ready.PRIVATE_CREATOR_MEDIA_ENABLED = "true";
  assert.equal(isPrivateCreatorMediaDeliveryReady(ready), true);
  const off = configured(); off.PRIVATE_CREATOR_MEDIA_ENABLED = "false";
  assert.equal(isPrivateCreatorMediaDeliveryReady(off), false);
  for (const missing of ["CREATOR_GENERATION_R2_ACCESS_KEY_ID", "CREATOR_GENERATION_R2_SECRET_ACCESS_KEY", "CREATOR_GENERATION_R2_BUCKET"] as const) {
    const env = { ...ready }; delete env[missing];
    assert.equal(isPrivateCreatorMediaDeliveryReady(env), false, missing);
  }
  const genericOnly = { ...ready };
  delete genericOnly.CREATOR_GENERATION_R2_ACCESS_KEY_ID; delete genericOnly.CREATOR_GENERATION_R2_SECRET_ACCESS_KEY; delete genericOnly.CREATOR_GENERATION_R2_BUCKET;
  assert.equal(isPrivateCreatorMediaDeliveryReady(genericOnly), false);
});
