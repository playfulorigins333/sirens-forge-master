import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'
const files=['lib/creator-publishing-queue/fanvue/workerCore.ts','lib/creator-publishing-queue/fanvue/capability.ts','lib/creator-publishing-queue/fanvue/history.ts']
const forbidden=['app/api/admin/autopost/fanvue','backend/autopost/admin','autopost_rules','autopost_jobs','/api/autopost/run','publishAt','x dispatch','reddit dispatch','diagnostic secret']
for(const file of files){const source=readFileSync(file,'utf8');for(const value of forbidden)assert.equal(source.toLowerCase().includes(value.toLowerCase()),false,`${file}: ${value}`)}
assert.match(readFileSync(files[0],'utf8'),/executePreparedFanvuePublication/)
assert.equal(readFileSync('vercel.json','utf8').includes('fanvue'),false)
console.log('Fanvue launch execution source contract passed')
