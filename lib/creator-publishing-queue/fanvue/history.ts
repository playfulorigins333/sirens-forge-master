export type FanvueHistoryRow = { id: string; creator_id: string; content_package_id: string; destination_id: string; publication_type: string; requested_publication_at: string; state: string; next_attempt_at: string | null; posted_at: string | null; safe_error_code: string | null; created_at: string; updated_at: string }
export type FanvueHistoryDto = Omit<FanvueHistoryRow, "creator_id">
export function toCreatorFanvueHistory(row: FanvueHistoryRow, creatorId: string): FanvueHistoryDto | null {
  if (row.creator_id !== creatorId) return null
  const { creator_id: _creatorId, ...safe } = row
  return safe
}
