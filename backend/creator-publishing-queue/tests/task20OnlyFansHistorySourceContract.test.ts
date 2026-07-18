import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
const files=["lib/creator-publishing-queue/onlyfans-history/loaders.ts","app/creator/publishing-queue/OnlyFansHistoryTimeline.tsx","lib/creator-publishing-queue/operator-completion/serviceCore.ts"].map(f=>[f,readFileSync(f,"utf8")] as const)
assert.match(files[0][1],/select\("id,creator_id,target_platform"\)/)
assert.match(files[0][1],/internal_request_snapshot/)
assert.doesNotMatch(files[1][1],/internal_request_snapshot|claim_token|request_fingerprint|server_path/)
assert.match(files[1][1],/<ol/)
assert.match(files[1][1],/<time dateTime=/)
assert.match(files[2][1],/creator_publishing_complete_onlyfans_manual_post_audited/g)
console.log("task20OnlyFansHistory source contract tests passed")
