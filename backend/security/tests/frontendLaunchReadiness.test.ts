import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveOwnedIdentityLoraMetadata, type IdentityLoraMetadataDependencies } from "../../../lib/generation/identityLoraMetadata";
import { isGenerationExecutionEnabled } from "../../../lib/generation/executionAvailability";
import { getAutopostPlatformRegistry } from "../../../lib/autopost/platformRegistry";
import {
  FANVUE_MEDIA_PUBLICATION_SCOPES,
  FANVUE_TEXT_PUBLICATION_SCOPES,
  hasFanvueGrantedPublicationScopes,
} from "../../../lib/creator-publishing-queue/fanvue/capability";
import { LAUNCH_CAPACITY } from "../../../lib/launch-capacity";
import { isPublicPath } from "../../../proxy";
import { parseGenerationSuccess } from "../../../lib/generation/upstreamResponse";

const owner="11111111-1111-4111-8111-111111111111", foreign="22222222-2222-4222-8222-222222222222", lora="33333333-3333-4333-8333-333333333333";
function deps(rowOwner=owner,status="completed"){let queries=0;const value:IdentityLoraMetadataDependencies={async loadOwnedCompletedLora(_id,userId){queries++;return userId===rowOwner&&status==="completed"?{artifact_r2_bucket:null,artifact_r2_key:"owned/key",trigger_token:"owner_token"}:null}};return{value,get queries(){return queries}}}

const own=deps(); const resolved=await resolveOwnedIdentityLoraMetadata(lora,owner,own.value); assert.equal(resolved.trigger_token,"owner_token");
const denied=deps(owner); await assert.rejects(()=>resolveOwnedIdentityLoraMetadata(lora,foreign,denied.value),/IDENTITY_LORA_UNAVAILABLE/);
const pending=deps(owner,"training"); await assert.rejects(()=>resolveOwnedIdentityLoraMetadata(lora,owner,pending.value),/IDENTITY_LORA_UNAVAILABLE/);
await assert.rejects(()=>resolveOwnedIdentityLoraMetadata("not-a-uuid",owner,own.value),/IDENTITY_LORA_UNAVAILABLE/);
assert.equal(isGenerationExecutionEnabled({GENERATION_EXECUTION_ENABLED:"true"} as NodeJS.ProcessEnv),true); assert.equal(isGenerationExecutionEnabled({GENERATION_EXECUTION_ENABLED:"TRUE"} as NodeJS.ProcessEnv),false); assert.equal(isGenerationExecutionEnabled({} as NodeJS.ProcessEnv),false);
assert.equal(isPublicPath("/privacy"),true); assert.equal(isPublicPath("/api/generate"),true); assert.equal(isPublicPath("/dashboard"),false);
assert(parseGenerationSuccess({success:true,images:["https://assets.test/a.png"],prompt_id:"p"}));
for(const malformed of [{success:false,images:["https://assets.test/a.png"]},{success:true},{success:true,images:["file:///etc/passwd"]},{success:true,outputs:[{kind:"video",url:"https://assets.test/a.png"}]}]) assert.equal(parseGenerationSuccess(malformed),null);

assert.deepEqual(LAUNCH_CAPACITY,{beta_reserved:25,og_throne:50,early_bird:150});
const home=await readFile("app/page.tsx","utf8"); assert(!home.includes("/120 LEFT")); assert(home.includes("LAUNCH_CAPACITY.early_bird")); assert(home.includes("useReducedMotion")); assert(home.includes("motion-reduce:animate-none")); assert(home.includes("Identity-first creation")); assert(home.includes("Generate directly, or add an AI Twin when you want a reusable identity")); assert(home.includes("Add an AI Twin when you want a consistent reusable identity.")); assert(home.includes("Choose whether to add an AI Twin")); assert(home.includes("Generate without one, or select an AI Twin")); assert(!home.includes("Your AI Twin identity anchors every generation.")); assert(!home.includes("Select or create your AI Twin before generating")); assert(!home.includes("Generate with your AI Twin"));
const generator=await readFile("app/generate/page.tsx","utf8"); assert(!generator.includes('subscriptionStatus: "active"')); assert(generator.includes('disabled={mode.unavailable}')); assert(generator.includes("Generation is temporarily unavailable."));
const route=await readFile("app/api/generate/route.ts","utf8"); assert(route.indexOf("isGenerationExecutionEnabled()")<route.indexOf("requireSirensApiConfig()")); assert(route.includes("resolveLoraStack(bodyMode, identityLora, userId)")); assert(route.includes('message === "IDENTITY_LORA_UNAVAILABLE"')); assert(route.includes('message: "Selected AI Twin is unavailable."')); assert(route.includes("{ status: 400 }"));
assert(route.includes("parseGenerationSuccess")); assert(route.includes("GENERATION_HISTORY_PERSISTENCE_FAILED")); assert(route.includes("retry_generation: false"));
const proxySource=await readFile("proxy.ts","utf8"); assert(proxySource.includes("supabase.auth.getUser()")); assert(proxySource.includes('const PUBLIC_PREFIXES = ["/_next", "/api", "/auth"]')); assert(proxySource.includes("if (!user)")); assert(proxySource.includes("NextResponse.redirect"));
const nextConfig=await readFile("next.config.mjs","utf8"); for(const header of ["Content-Security-Policy","Strict-Transport-Security","X-Content-Type-Options","X-Frame-Options","Referrer-Policy","Permissions-Policy"]) assert(nextConfig.includes(header),header);
assert(!/output\s*:\s*["']standalone["']/.test(nextConfig), "Vercel frontend must not force standalone output");
const workflow=await readFile(".github/workflows/frontend-launch-readiness.yml","utf8"); assert(!workflow.includes("paths:")); assert(workflow.includes("npm audit --omit=dev --audit-level=high")); assert(workflow.includes("npm run build")); assert(workflow.includes('GENERATION_EXECUTION_ENABLED: "false"'));

const videoRoute = await readFile("app/api/video/route.ts", "utf8");
assert(videoRoute.includes("isVideoSubmissionReady"));
assert(videoRoute.includes("submitVideoProject"));
await assert.rejects(readFile("app/api/generate_video/route.ts", "utf8"));
assert(!videoRoute.includes("RUNPOD_"));

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
const layout=await readFile("app/layout.tsx","utf8"); assert(!layout.includes('<main className="flex-1">')); assert(layout.includes('import "./reduced-motion.css"'));
const reducedMotion=await readFile("app/reduced-motion.css","utf8"); assert(reducedMotion.includes("prefers-reduced-motion: reduce")); assert(reducedMotion.includes('[style*="box-shadow"]')); assert(reducedMotion.includes('[style*="background-position"]'));
const sitemap=await readFile("app/sitemap.ts","utf8"); assert(!/dashboard|account|billing|login|generate/.test(sitemap));
const faq=await readFile("app/faq/page.tsx","utf8"); assert(faq.includes("identity-first AI creation platform centered on reusable AI Twin identities")); assert(faq.includes("No. You can generate images without training or selecting an AI Twin.")); assert(faq.includes("optional custom-trained AI model (LoRA)")); assert(faq.includes("Text → Image, Text → Video, and Image → Video")); assert(!faq.includes("Generation requires you to create and select an AI Twin identity")); assert(!faq.includes("create AI-generated images, videos")); assert(!faq.includes("Video generation is Coming Soon")); assert(faq.includes("$1,333 one-time")); assert(faq.includes("OG Founder")); assert(faq.includes("$29.99/month")); assert(faq.includes("Early Bird")); assert(!faq.includes("Sirens Forge operates on a subscription model. You are billed on a recurring basis through our payment provider.")); assert(faq.includes("admin@sirensforge.vip")); for(const safetyGuidance of ["minors", "non-consensual acts", "real-person exploitation", "illegal activity"])assert(faq.includes(safetyGuidance),safetyGuidance);
const footer=await readFile("components/layout/Footer.tsx","utf8"); assert(footer.includes("Identity-first AI media and creator workflows.")); assert(!footer.includes("AI generation for images, video"));
console.log("frontend launch readiness focused contracts: PASS");
