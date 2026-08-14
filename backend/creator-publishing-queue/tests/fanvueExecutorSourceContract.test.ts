import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source=readFileSync('lib/creator-publishing-queue/fanvue/executor.ts','utf8')
for(const forbidden of ['app/api/admin/autopost/fanvue','backend/autopost/admin','FANVUE_INTERNAL_SINGLE_POST_CONFIRMATION','REQUEST_FANVUE_INTERNAL_SINGLE_POST','publishAt','autopost_rules','autopost_jobs']) assert.equal(source.includes(forbidden),false,`executor contains forbidden source contract: ${forbidden}`)
assert.doesNotMatch(source,/fanvueInternalAdapter|fanvueInternalSinglePostRoute/)
console.log('CPQ Fanvue executor source-contract tests passed')
