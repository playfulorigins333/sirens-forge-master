import { CreatorReplyContinuity, parseCreatorReplyContinuity } from "./creator-reply"
export const MAX_RECENT_TURNS = 6, MAX_SINGLE_STORED_TURN_CHARS = 6000, MAX_RECENT_TAIL_TOTAL_CHARS = 24000
export type CreatorReplyTurn = { role: "subscriber" | "creator"; text: string }
export type CreatorReplyCheckpoint = { version: 1; label: string; continuity: CreatorReplyContinuity; recent_turns: CreatorReplyTurn[] }
export const emptyCreatorReplyContinuity = (): CreatorReplyContinuity => ({ version: 1, creator_persona: "", subscriber_persona: "", relationship: "", scene: "", summary: "" })
export const emptyCreatorReplyCheckpoint = (): CreatorReplyCheckpoint => ({ version: 1, label: "", continuity: emptyCreatorReplyContinuity(), recent_turns: [] })
export function trimCreatorReplyTurns(input: CreatorReplyTurn[]) {
  const turns = input.filter(t => (t.role === "subscriber" || t.role === "creator") && typeof t.text === "string").map(t => ({...t,text:t.text.slice(0,MAX_SINGLE_STORED_TURN_CHARS)})).slice(-MAX_RECENT_TURNS)
  while (turns.reduce((n,t)=>n+t.text.length,0)>MAX_RECENT_TAIL_TOTAL_CHARS) turns.shift()
  return turns
}
export function parseCreatorReplyCheckpoint(value: unknown): CreatorReplyCheckpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const v=value as Record<string,unknown>, continuity=parseCreatorReplyContinuity(v.continuity)
  if (v.version!==1 || typeof v.label!=="string" || v.label.length>160 || !continuity || !Array.isArray(v.recent_turns)) return null
  const turns=trimCreatorReplyTurns(v.recent_turns as CreatorReplyTurn[])
  return turns.length===v.recent_turns.length ? {version:1,label:v.label,continuity,recent_turns:turns} : null
}
