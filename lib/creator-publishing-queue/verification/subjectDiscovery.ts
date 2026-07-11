export const TRUSTED_VERIFICATION_CREATOR_LIMIT = 50
export const TRUSTED_VERIFICATION_ACCOUNT_SUBJECT_LIMIT = 100
export const TRUSTED_VERIFICATION_DISCOVERY_PAGE_SIZE = 500
export const TRUSTED_VERIFICATION_DISCOVERY_MAX_PAGES = 200

const CREATOR_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type VerificationCreatorIdRow = {
  creator_id: unknown
}

function isCreatorUuid(value: unknown): value is string {
  return typeof value === "string" && CREATOR_UUID_PATTERN.test(value.trim())
}

export function buildTrustedVerificationCreatorIds(
  packageRows: VerificationCreatorIdRow[],
  accountRows: VerificationCreatorIdRow[],
  limit: number = TRUSTED_VERIFICATION_CREATOR_LIMIT
): string[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > TRUSTED_VERIFICATION_CREATOR_LIMIT) {
    throw new Error("Invalid trusted verification creator limit")
  }

  const ids = new Set<string>()
  for (const row of [...packageRows, ...accountRows]) {
    if (isCreatorUuid(row.creator_id)) ids.add(row.creator_id.trim().toLowerCase())
  }

  return Array.from(ids).sort((a, b) => a.localeCompare(b)).slice(0, limit)
}
