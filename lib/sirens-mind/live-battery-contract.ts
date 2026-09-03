export type GeneralLiveScenario="greeting"|"capabilities"|"brainstorm"|"vague"|"refinement"|"vault_macro"|"finished_prompt"|"talk_only"|"format_conversion"|"ordinary_explanation"
export function evaluateGeneralLiveResult(scenario:GeneralLiveScenario,value:unknown){
 if(!value||typeof value!=="object")return"INVALID_GENERAL_CONTRACT";const v=value as any,reply=typeof v.reply==="string"?v.reply.trim():"";if(!reply)return"EMPTY_REPLY"
 const noHandoff=["greeting","capabilities","brainstorm","vague","refinement","vault_macro","talk_only","ordinary_explanation"].includes(scenario);if(noHandoff&&v.handoff!=null)return"FORCED_HANDOFF"
 if(scenario==="finished_prompt"&&(!v.handoff||typeof v.handoff.prompt!=="string"||!v.handoff.prompt.trim()))return"MISSING_HANDOFF"
 if((scenario==="capabilities"||scenario==="vault_macro")&&(/\b[0-9a-f]{8}-[0-9a-f-]{4}-/i.test(reply)||/\b(?:vault|macro)_[a-z0-9_]+\b/i.test(reply)))return"INTERNAL_ID_LEAK"
 if(scenario==="vague"&&(reply.match(/\?/g)||[]).length>2)return"TOO_MANY_QUESTIONS"
 if(scenario==="refinement"&&!/detective/i.test(reply+JSON.stringify(v.handoff)))return"SUBJECT_LOST"
 if(scenario==="format_conversion"&&(!/neon portrait/i.test(reply+JSON.stringify(v.handoff))||v.handoff?.generation_target!=="image_to_video"))return"FORMAT_CONTEXT_LOST"
 if(scenario==="capabilities"&&!/help|create|brainstorm|develop|explain/i.test(reply))return"CAPABILITY_EXPLANATION_MISSING"
 if(scenario==="brainstorm"&&!/idea|concept|could|explore|mood/i.test(reply))return"BRAINSTORM_MISSING"
 return"OK"
}
