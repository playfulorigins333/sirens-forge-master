const EXPLICIT_STORY_REQUESTS = [
  /\bwrite\b[\s\S]{0,80}\b(?:story|chapter)\b/i,
  /\bturn\s+this\s+into\s+(?:a\s+)?(?:complete|full)\s+(?:prose\s+)?story\b/i,
  /\bcontinue\s+(?:the|this)\s+(?:story|chapter)\b/i,
  /\bwrite\s+chapter\s+\d+\b/i,
]

const LENGTH_DIRECTED_STORY = /\bwrite\b[\s\S]*\b(?:\d[\d,]*\s*[-–]?\s*word|\d+\s*[-–]\s*\d+\s*page|\d+\s*page)[s]?\b[\s\S]*\b(?:story|chapter|scene|prose)\b/i
const ADVICE_OR_DISCUSSION = /\b(?:how\s+do\s+i|help\s+me\s+brainstorm|ideas?\s+for|story\s+ideas?|what\s+makes|discuss\s+the\s+plot|(?:outline|prompt)\s+for\s+(?:a\s+)?story)\b/i

export function shouldActivateLongformStory(message: string): boolean {
  const normalized = message.trim()
  if (!normalized || ADVICE_OR_DISCUSSION.test(normalized)) return false
  return LENGTH_DIRECTED_STORY.test(normalized) || EXPLICIT_STORY_REQUESTS.some((pattern) => pattern.test(normalized))
}
