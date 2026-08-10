import "server-only"

import { requireUserId } from "@/lib/supabaseServer"

const X_ADMIN_USER_IDS_ENV = "AUTOPOST_X_ADMIN_USER_IDS"
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type XAdminAuthorizationDependencies = {
  requireAuthenticatedUserId?: typeof requireUserId
  readAdminUserIds?: () => string | undefined
}

/**
 * Authenticates the request and then enforces the server-only X administrator
 * allowlist. All failures deliberately share one sanitized error.
 */
export async function requireXAdminUserId(
  options: { request?: Request } = {},
  dependencies: XAdminAuthorizationDependencies = {}
): Promise<string> {
  const authenticate = dependencies.requireAuthenticatedUserId ?? requireUserId
  const readAdminUserIds =
    dependencies.readAdminUserIds ?? (() => process.env[X_ADMIN_USER_IDS_ENV])

  const authenticatedUserId = (await authenticate(options)).trim()
  const allowedUserIds = new Set(
    (readAdminUserIds() ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => CANONICAL_UUID.test(entry))
      .map((entry) => entry.toLowerCase())
  )

  if (
    !CANONICAL_UUID.test(authenticatedUserId) ||
    allowedUserIds.size === 0 ||
    !allowedUserIds.has(authenticatedUserId.toLowerCase())
  ) {
    throw new Error("Unauthorized")
  }

  return authenticatedUserId
}
