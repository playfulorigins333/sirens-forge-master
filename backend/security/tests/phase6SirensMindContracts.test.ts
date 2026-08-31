import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
const [route, chat, input, generator, page, bundle] = await Promise.all([
  readFile("app/api/nsfw-gpt/headless/route.ts", "utf8"), readFile("components/chat/ChatUI.tsx", "utf8"),
  readFile("components/chat/ChatInput.tsx", "utf8"), readFile("app/generate/page.tsx", "utf8"),
  readFile("app/sirens-mind/page.tsx", "utf8"), readFile("prompts/nsfw_gpt/bundle.conversational.system.txt", "utf8"),
])
assert.match(chat, /interaction_mode: "conversation"/)
assert.match(generator, /interaction_mode: "headless"/)
assert.match(route, /interactionMode === "conversation" \? CONVERSATION_GOVERNOR : HEADLESS_CONTRACT/)
assert.match(route, /kind === "clarification"/)
assert.match(route, /kind !== "prompt" \|\| !message \|\| !prompt \|\| !target/)
assert.match(chat, /data\.kind === "clarification"/)
assert.match(chat, /canUseInGenerator: true/)
assert.match(input, /onSend: \(userText: string, selectedMode: Mode\)/)
assert.match(input, /await onSend\(trimmed, localMode\)/)
assert.doesNotMatch(input, /setTimeout/)
assert.match(chat, /mode: selectedMode/)
for (const mode of ["SAFE", "NSFW", "ULTRA"]) assert.ok(input.includes(`modeButton("${mode}")`))
assert.ok(generator.includes("GENERATOR_MIND_CONTEXT_STORAGE_KEY"))
assert.ok(page.includes("GENERATOR_MIND_CONTEXT_KEY"))
for (const field of ["generation_target", "prompt", "negative_prompt", "identity", "created_at", "version"]) assert.ok(generator.includes(field))
for (const forbidden of ["artifact_r2_bucket", "artifact_r2_key", "provider", "checkpoint", "service_credentials"]) assert.ok(!page.includes(forbidden))
assert.match(generator, /mode === "image_to_video" && imageFile && !sourceGenerationAssetId/)
assert.match(generator, /local source image must remain on Generator/)
assert.doesNotMatch(generator, /IMAGE, VIDEO, or STORY output/)
assert.match(bundle, /fluid, adaptive clarification/)
assert.doesNotMatch(bundle, /Blocks generation until confirmation|Guide users through the funnel in order/)
console.log("Phase 6 Siren's Mind contracts: PASS")
