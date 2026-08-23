import assert from "node:assert/strict"
import test from "node:test"
import { FRESH_TOTP_MAX_AGE_SECONDS, newestFreshTotpTimestamp } from "../../../lib/security/mfa"
import { safeInternalNext } from "../../../lib/material-policy/redirect"

test("fresh TOTP uses the authoritative ten minute boundary", () => {
  const now = 2_000_000_000_000
  assert.equal(FRESH_TOTP_MAX_AGE_SECONDS, 600)
  assert.equal(newestFreshTotpTimestamp([{ method: "totp", timestamp: now / 1000 - 599 }], now), now - 599_000)
  assert.equal(newestFreshTotpTimestamp([{ method: "totp", timestamp: now / 1000 - 600 }], now), now - 600_000)
  assert.equal(newestFreshTotpTimestamp([{ method: "totp", timestamp: now / 1000 - 601 }], now), null)
  assert.equal(newestFreshTotpTimestamp([{ method: "password", timestamp: now / 1000 }], now), null)
  assert.equal(newestFreshTotpTimestamp([{ method: "totp", timestamp: "bad" }], now), null)
  assert.equal(newestFreshTotpTimestamp([{ method: "totp", timestamp: now / 1000 + 6 }], now), null)
})

test("MFA continuation shares strict internal redirect validation", () => {
  assert.equal(safeInternalNext("/billing?claim=1"), "/billing?claim=1")
  for (const unsafe of ["https://evil.test", "//evil.test", "javascript:alert(1)", "/\\evil.test", "%2F%2Fevil.test"]) assert.equal(safeInternalNext(unsafe), "/dashboard")
})
