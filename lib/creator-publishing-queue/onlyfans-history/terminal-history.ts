export const TERMINAL_HISTORY_PAGE_SIZE = 25

export const ONLYFANS_TERMINAL_JOB_STATES = [
  "confirmed_posted_manual",
  "failed_manual_upload",
  "skipped",
  "blocked",
  "platform_rejected",
  "archived",
] as const

type TerminalHistoryCursor = {
  updatedAt: string
  platformJobId: string
}

type TerminalHistoryRow = {
  id: string
  creator_id: string
  content_package_id: string
  target_platform?: string
  publishing_mode?: string
  job_state: string
  updated_at: string
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validCursor(value: unknown): value is TerminalHistoryCursor {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<TerminalHistoryCursor>
  return typeof candidate.updatedAt === "string" &&
    !Number.isNaN(Date.parse(candidate.updatedAt)) &&
    typeof candidate.platformJobId === "string" &&
    uuidPattern.test(candidate.platformJobId)
}

export function encodeTerminalHistoryCursor(cursor: TerminalHistoryCursor) {
  return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")
}

export function decodeTerminalHistoryCursor(value?: string | null): TerminalHistoryCursor | null {
  if (!value || !/^[A-Za-z0-9_-]+$/u.test(value)) return null
  try {
    const base64=value.replaceAll("-", "+").replaceAll("_", "/")
    const padded=base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")
    const decoded: unknown = JSON.parse(atob(padded))
    return validCursor(decoded) ? decoded : null
  } catch {
    return null
  }
}

export function compareTerminalHistoryRowsNewestFirst(left: TerminalHistoryRow, right: TerminalHistoryRow) {
  return right.updated_at.localeCompare(left.updated_at) || right.id.localeCompare(left.id)
}

function followsCursor(row: TerminalHistoryRow, cursor: TerminalHistoryCursor | null) {
  if (!cursor) return true
  return row.updated_at < cursor.updatedAt || (row.updated_at === cursor.updatedAt && row.id < cursor.platformJobId)
}

export function paginateTerminalHistoryRows(
  rows: TerminalHistoryRow[],
  authorizedCreatorIds: string[],
  cursorValue?: string | null,
  pageSize = TERMINAL_HISTORY_PAGE_SIZE,
) {
  const authorized = new Set(authorizedCreatorIds)
  const terminalStates = new Set<string>(ONLYFANS_TERMINAL_JOB_STATES)
  const cursor = decodeTerminalHistoryCursor(cursorValue)
  const eligible = rows
    .filter(row =>
      authorized.has(row.creator_id) &&
      row.target_platform === "onlyfans" &&
      row.publishing_mode === "assisted" &&
      terminalStates.has(row.job_state) &&
      typeof row.updated_at === "string" &&
      !Number.isNaN(Date.parse(row.updated_at)) &&
      typeof row.id === "string" &&
      uuidPattern.test(row.id),
    )
    .sort(compareTerminalHistoryRowsNewestFirst)
    .filter(row => followsCursor(row, cursor))
  const pageRows = eligible.slice(0, pageSize)
  const last = pageRows.at(-1)
  return {
    rows: pageRows,
    nextCursor: eligible.length > pageSize && last
      ? encodeTerminalHistoryCursor({ updatedAt: last.updated_at, platformJobId: last.id })
      : null,
  }
}

export function nextTerminalHistoryCursor(rows: TerminalHistoryRow[], pageSize = TERMINAL_HISTORY_PAGE_SIZE) {
  if (rows.length <= pageSize) return null
  const last = rows[pageSize - 1]
  if (!last || !validCursor({ updatedAt: last.updated_at, platformJobId: last.id })) return null
  return encodeTerminalHistoryCursor({ updatedAt: last.updated_at, platformJobId: last.id })
}
