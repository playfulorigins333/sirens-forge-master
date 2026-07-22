import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const pagePath = 'app/autopost/page.tsx'
const page = () => readFileSync(pagePath, 'utf8')

test('public AutoPost page preserves auth and subscription gates', () => {
  const src = page()
  assert.match(src, /ensureActiveSubscription\s*\(\s*\)/)
  assert.match(src, /redirect\(\s*["']\/login["']\s*\)/)
  assert.match(src, /redirect\(\s*["']\/pricing["']\s*\)/)
})

test('public AutoPost page renders only the required unavailable customer copy', () => {
  const src = page()
  assert.match(src, />\s*AutoPost\s*</)
  assert.match(src, /AutoPost is currently unavailable/)
  assert.match(src, /Publishing automation and scheduling are not available for customer use right now\. Your existing records remain preserved\./)
  assert.match(src, /No publishing, scheduling, or external-platform action can be started from this page\./)
  assert.match(src, /href=\{?["']\/dashboard["']\}?/)
})

test('public AutoPost page does not load dormant customer controls or data loaders', () => {
  const src = page()
  for (const forbidden of [
    'AutopostPageClient',
    'Task14AutopostOrchestration',
    'Task15PlanScheduling',
    'loadAutopostCapabilities',
    'loadAutopostPackageOptions',
    'loadCreatorPublishingSchedulingView',
    'randomUUID',
  ]) {
    assert.equal(src.includes(forbidden), false, `${forbidden} must not be referenced from ${pagePath}`)
  }
})

test('public AutoPost page exposes no queue, operator, scheduling, platform-account, form, or mutation controls', () => {
  const src = page()
  for (const forbiddenPattern of [
    /href=\{?["']\/creator\/publishing-queue(?:\/new)?["']\}?/,
    /href=\{?["'][^"']*operator[^"']*queue[^"']*["']\}?/i,
    /href=\{?["'][^"']*schedul[^"']*["']\}?/i,
    /href=\{?["'][^"']*platform-accounts?[^"']*["']\}?/i,
    /<form\b/i,
    /<button\b(?![^>]*disabled)/i,
    /type=\{?["']submit["']\}?/i,
    /onSubmit=|formAction=|action=\{?[^}\n]*\}?/,
    /Build Rule|Refresh Rules?|Create X|Fanvue|Publishing Plan|Schedule|Cancel|Launch Creator Publishing Queue/i,
  ]) {
    assert.doesNotMatch(src, forbiddenPattern)
  }
})

test('dormant AutoPost files remain present and vercel cron remains unregistered', () => {
  for (const dormantPath of [
    'app/autopost/AutopostPageClient.tsx',
    'app/autopost/Task14AutopostOrchestration.tsx',
    'app/autopost/Task15PlanScheduling.tsx',
    'app/api/autopost/run/route.ts',
  ]) {
    assert.equal(existsSync(dormantPath), true, `${dormantPath} must remain present`)
  }

  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { version?: unknown; crons?: unknown }
  const crons = vercel.crons === undefined ? [] : vercel.crons
  assert.equal(vercel.version, 2)
  assert.deepEqual(Object.keys(vercel).sort(), ['version'])
  assert.deepEqual(crons, [])
})

console.log('task22PublicAutopostScopeLockSourceContract ok')
