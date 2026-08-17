import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureUserLoraCached, type LoraCacheDependencies } from "../../../lib/generation/ensureUserLoraCached";
import { isGenerationExecutionEnabled } from "../../../lib/generation/executionAvailability";
import { getAutopostPlatformRegistry } from "../../../lib/autopost/platformRegistry";
import {
  FANVUE_MEDIA_PUBLICATION_SCOPES,
  FANVUE_TEXT_PUBLICATION_SCOPES,
  hasFanvueGrantedPublicationScopes,
} from "../../../lib/creator-publishing-queue/fanvue/capability";
import { LAUNCH_CAPACITY } from "../../../lib/launch-capacity";

const owner="11111111-1111-4111-8111-111111111111", foreign="22222222-2222-4222-8222-222222222222", lora="33333333-3333-4333-8333-333333333333";
function deps(rowOwner=owner,status="completed",cached=true){let downloads=0;const value:LoraCacheDependencies={async loadOwnedCompletedLora(_id,userId){return userId===rowOwner&&status==="completed"?{artifact_r2_bucket:null,artifact_r2_key:"owned/key",trigger_token:"owner_token"}:null},async fileExists(){return cached},async download(){downloads++;return new Uint8Array([1])},async write(){}};return{value,get downloads(){return downloads}}}

const own=deps(); const resolved=await ensureUserLoraCached(lora,owner,own.value); assert.equal(resolved.metadata.trigger_token,"owner_token");
const denied=deps(owner,"completed",true); await assert.rejects(()=>ensureUserLoraCached(lora,foreign,denied.value),/IDENTITY_LORA_UNAVAILABLE/); assert.equal(denied.downloads,0,"foreign cached file must not bypass ownership or call R2");
const pending=deps(owner,"training",false); await assert.rejects(()=>ensureUserLoraCached(lora,owner,pending.value),/IDENTITY_LORA_UNAVAILABLE/); assert.equal(pending.downloads,0);
await assert.rejects(()=>ensureUserLoraCached("not-a-uuid",owner,own.value),/IDENTITY_LORA_UNAVAILABLE/);
assert.equal(isGenerationExecutionEnabled({GENERATION_EXECUTION_ENABLED:"true"} as NodeJS.ProcessEnv),true); assert.equal(isGenerationExecutionEnabled({GENERATION_EXECUTION_ENABLED:"TRUE"} as NodeJS.ProcessEnv),false); assert.equal(isGenerationExecutionEnabled({} as NodeJS.ProcessEnv),false);

assert.deepEqual(LAUNCH_CAPACITY,{beta_reserved:25,og_throne:50,early_bird:150});
const home=await readFile("app/page.tsx","utf8"); assert(!home.includes("/120 LEFT")); assert(home.includes("LAUNCH_CAPACITY.early_bird")); assert(home.includes("useReducedMotion")); assert(home.includes("motion-reduce:animate-none"));
const generator=await readFile("app/generate/page.tsx","utf8"); assert(!generator.includes('subscriptionStatus: "active"')); assert(generator.includes('disabled={mode.unavailable}')); assert(generator.includes("Image generation is temporarily unavailable."));
const route=await readFile("app/api/generate/route.ts","utf8"); assert(route.indexOf("isGenerationExecutionEnabled()")<route.indexOf("requireSirensApiConfig()")); assert(route.includes("resolveLoraStack(bodyMode, identityLora, userId)")); assert(route.includes('message === "IDENTITY_LORA_UNAVAILABLE"')); assert(route.includes('message: "Selected AI Twin is unavailable."')); assert(route.includes("{ status: 400 }"));

for (const videoPath of ["app/api/video/route.ts", "app/api/generate_video/route.ts"]) {
  const videoRoute = await readFile(videoPath, "utf8");
  assert(videoRoute.includes('error: "VIDEO_GENERATION_UNAVAILABLE"'), `${videoPath} must expose the stable unavailable contract`);
  assert(videoRoute.includes("status: 503"), `${videoPath} must fail closed with 503`);
  assert(!videoRoute.includes("RUNPOD_"), `${videoPath} must not contain executable RunPod routing`);
  assert(!videoRoute.includes("resolveLoraStack("), `${videoPath} must not resolve LoRAs while video is disabled`);
}

assert.equal(hasFanvueGrantedPublicationScopes([], FANVUE_TEXT_PUBLICATION_SCOPES), false);
assert.equal(hasFanvueGrantedPublicationScopes(["read:self"], FANVUE_TEXT_PUBLICATION_SCOPES), false);
assert.equal(hasFanvueGrantedPublicationScopes(["write:post"], FANVUE_TEXT_PUBLICATION_SCOPES), true);
assert.equal(hasFanvueGrantedPublicationScopes(["write:post", "read:media", "write:media"], FANVUE_MEDIA_PUBLICATION_SCOPES), false);
assert.equal(hasFanvueGrantedPublicationScopes(["write:post", "read:media", "write:media", "write:creator"], FANVUE_MEDIA_PUBLICATION_SCOPES), true);

const registry=getAutopostPlatformRegistry(); const fanvue=registry.find(p=>p.id==="fanvue")!; assert.equal(fanvue.public_selectable,false); assert.equal(fanvue.supports_real_posting,true); assert.equal(fanvue.env_var,undefined);
const availability=await readFile("lib/autopost/platformAvailability.ts","utf8"); const fanvueBranch=availability.slice(availability.indexOf('if (platform.id === "fanvue")'),availability.indexOf('if (platform.id === "x")')); assert(fanvueBranch.includes("can_schedule: false")); assert(fanvueBranch.includes("public_selectable: false")); assert(fanvueBranch.includes("native_posting_available: false")); assert(fanvueBranch.includes("supports_text_posting: textReady")); assert(fanvueBranch.includes("supports_media_posting: mediaReady"));
const platformMe=await readFile("app/api/autopost/platforms/me/route.ts","utf8"); assert(platformMe.includes("token_key_version, scopes, metadata"));
for(const id of ["x","reddit"]){const p=registry.find(v=>v.id===id)!;assert.equal(p.public_selectable,false)}
const onlyfans=registry.find(p=>p.id==="onlyfans")!;assert.equal(onlyfans.supports_assisted_workflow,true);assert.equal(onlyfans.public_selectable,false);
const fanvueUi=(await Promise.all(["app/autopost/AutopostPageClient.tsx","app/creator/publishing-queue/accounts/page.tsx","app/creator/publishing-queue/composer/PackageComposerForm.tsx"].map(f=>readFile(f,"utf8")))).join("\n"); assert(!/FROZEN|still being built|still in development/i.test(fanvueUi)); assert(/final activation pending/i.test(fanvueUi));
const history=await readFile("lib/creator-publishing-queue/fanvue/history.ts","utf8"); assert(history.includes('.eq("creator_id",creatorId)')); assert(!history.includes('select("*")')); assert(!history.includes("lease_token"));
const historyPage=await readFile("app/creator/publishing-queue/fanvue/page.tsx","utf8"); assert(historyPage.includes("No Fanvue publishing jobs yet.")); assert(!/token|ciphertext|credential/i.test(historyPage));
const login=await readFile("app/login/LoginClient.tsx","utf8"); for(const contract of ['htmlFor="email"','id="email"','autoComplete="email"','htmlFor="password"','aria-pressed={show}','role="alert"'])assert(login.includes(contract),contract);
const layout=await readFile("app/layout.tsx","utf8"); assert(!layout.includes('<main className="flex-1">'));
const sitemap=await readFile("app/sitemap.ts","utf8"); assert(!/dashboard|account|billing|login|generate/.test(sitemap));
console.log("frontend launch readiness focused contracts: PASS");
