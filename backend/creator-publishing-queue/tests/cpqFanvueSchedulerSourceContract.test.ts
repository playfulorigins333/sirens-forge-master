import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

const activation = readFileSync("supabase/manual/cpq_fanvue_scheduler_activation.sql", "utf8")
const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons?: Array<{ path?: string }> }

test("the Fanvue launch trigger reaches only the authoritative CPQ run route", () => {
  const apiPaths = activation.match(/\/api\/[a-z0-9_?&=/.-]+/gi) ?? []
  assert.deepEqual([...new Set(apiPaths)], ["/api/creator-publishing-queue/fanvue/run"])
  assert.doesNotMatch(activation, /\/api\/autopost\/run/i)
  assert.doesNotMatch(activation, /autopost_(rules|jobs|job_logs)/i)
})

test("activation is duplicate-safe and Vercel does not add a second Fanvue trigger", () => {
  assert.match(activation, /jobname <> 'sirens_forge_cpq_fanvue_runner'/)
  assert.match(activation, /raise exception 'A different recurring trigger already targets the CPQ Fanvue runner'/)
  assert.match(activation, /cron\.unschedule\(v_existing_job_id\)/)
  assert.equal((vercel.crons ?? []).some(({ path }) => /fanvue|autopost/i.test(path ?? "")), false)
})

test("scheduler credentials are resolved from Vault rather than committed in cron SQL", () => {
  assert.match(activation, /vault\.decrypted_secrets/)
  assert.match(activation, /'Authorization'/)
  assert.match(activation, /'Bearer ' \|\|/)
  assert.doesNotMatch(activation, /replace_me|https?:\/\//i)
})
