export const CHAT_HISTORY_MAX_MESSAGES = 24
export const CHAT_HISTORY_MAX_MESSAGE_CHARS = 8000
export const CHAT_HISTORY_MAX_TOTAL_CHARS = 48000

type HistorySource = { id: string; role: "user" | "assistant"; content: string; isError?: boolean }
export type BoundedHistoryMessage = { role: "user" | "assistant"; content: string }

export function buildBoundedChatHistory(items: HistorySource[]): BoundedHistoryMessage[] {
  const recent = items.filter((item) => !item.isError && item.id !== "generator-context").slice(-CHAT_HISTORY_MAX_MESSAGES)
  const bounded: BoundedHistoryMessage[] = []
  let remaining = CHAT_HISTORY_MAX_TOTAL_CHARS

  for (let index = recent.length - 1; index >= 0 && remaining > 0; index--) {
    const item = recent[index]
    const limit = Math.min(CHAT_HISTORY_MAX_MESSAGE_CHARS, remaining)
    const content = item.content.length > limit ? item.content.slice(-limit) : item.content
    if (!content) continue
    bounded.push({ role: item.role, content })
    remaining -= content.length
  }
  return bounded.reverse()
}
