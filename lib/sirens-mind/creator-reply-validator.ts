export const CREATOR_REPLY_MAX_VISIBLE_CHARS = 12_000
export type CreatorReplyViolation = "MALFORMED_METADATA" | "INVALID_SEGMENT" | "UNGROUNDED_REFERENCE" | "VISIBLE_CONTENT_FORBIDDEN" | "VISIBLE_TOO_LONG"

const SPEECH = {
  greeting: "Hey—you have my attention.", warm_ack: "I’m glad you told me.", invite_more: "Tell me more.",
  ask_intent: "What do you want from me?", ask_detail: "What happens next?", ask_feeling: "How does that feel to you?",
  flirt_interest: "Now you have me curious.", tease_prove_it: "Then prove it.", challenge_continue: "Go on—show me what you’ve got.",
  command_come_closer: "Come closer.", command_answer: "Answer me.", command_wait: "Wait for me.", command_continue: "Keep going.",
  playful_threat: "Careful—I might hold you to that.", creator_intent_lead: "I’ll decide where we go next.", creator_intent_continue: "I want to keep this going.",
  consent_check: "Tell me if you want to continue.", safeword_ack: "Say red and I stop.", appreciation: "I like that.", anticipation: "I can’t wait.",
  cautious: "I’m not ready to trust you yet.", boundary: "I’ll set the pace.", friendly_reply: "It’s good to hear from you.",
} as const
const ACTION = { smile: "I smile.", grin: "I grin.", pause: "I pause.", wait: "I wait.", step_closer: "I step closer.", fold_arms: "I fold my arms.", tilt_head: "I tilt my head.", raise_eyebrow: "I raise an eyebrow." } as const
const THOUGHT = { curious: "I’m curious.", intrigued: "I’m intrigued.", cautious: "I stay cautious.", pleased: "I’m pleased.", considering: "I consider my next move." } as const
type Segment = { kind:"speech"; value:keyof typeof SPEECH }|{kind:"action";value:keyof typeof ACTION}|{kind:"thought";value:keyof typeof THOUGHT}|{kind:"grounded";evidence:string}

export function renderCreatorReplyMetadata(metadata:unknown, authoritativeSources:string[]) {
  if(!metadata||typeof metadata!=="object"||Array.isArray(metadata))return{ok:false as const,code:"MALFORMED_METADATA" as CreatorReplyViolation}
  const raw=metadata as Record<string,unknown>
  if(raw.version!==2||Object.keys(raw).some(k=>!["version","segments"].includes(k))||!Array.isArray(raw.segments)||!raw.segments.length||raw.segments.length>16)return{ok:false as const,code:"MALFORMED_METADATA" as CreatorReplyViolation}
  const authority=new Set(authoritativeSources.map(v=>v.trim()).filter(Boolean));const rendered:string[]=[]
  for(const item of raw.segments){if(!item||typeof item!=="object"||Array.isArray(item))return{ok:false as const,code:"INVALID_SEGMENT" as CreatorReplyViolation};const s=item as Record<string,unknown>
    if(s.kind==="speech"&&Object.keys(s).every(k=>["kind","value"].includes(k))&&typeof s.value==="string"&&s.value in SPEECH)rendered.push(SPEECH[s.value as keyof typeof SPEECH])
    else if(s.kind==="action"&&Object.keys(s).every(k=>["kind","value"].includes(k))&&typeof s.value==="string"&&s.value in ACTION)rendered.push(ACTION[s.value as keyof typeof ACTION])
    else if(s.kind==="thought"&&Object.keys(s).every(k=>["kind","value"].includes(k))&&typeof s.value==="string"&&s.value in THOUGHT)rendered.push(THOUGHT[s.value as keyof typeof THOUGHT])
    else if(s.kind==="grounded"&&Object.keys(s).every(k=>["kind","evidence"].includes(k))&&typeof s.evidence==="string"&&authority.has(s.evidence.trim()))rendered.push(s.evidence.trim())
    else return{ok:false as const,code:s.kind==="grounded"?"UNGROUNDED_REFERENCE":"INVALID_SEGMENT" as CreatorReplyViolation}
  }
  const text=rendered.join(" ").trim();if(!text||text.length>CREATOR_REPLY_MAX_VISIBLE_CHARS)return{ok:false as const,code:"VISIBLE_TOO_LONG" as CreatorReplyViolation};return{ok:true as const,code:"OK" as const,text}
}

/** Provider prose is never rendered; only locally rendered closed-schema primitives are visible. */
export function validateCreatorReplyCandidate(providerVisible:string,metadata:unknown,authoritativeSources:string[]){
  if(providerVisible.trim())return{ok:false as const,code:"VISIBLE_CONTENT_FORBIDDEN" as CreatorReplyViolation}
  return renderCreatorReplyMetadata(metadata,authoritativeSources)
}
