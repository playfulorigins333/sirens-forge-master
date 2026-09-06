import "server-only";
import {getSupabaseAdmin} from "@/lib/supabaseAdmin";

export const SAFETY_CATEGORIES=["GENERAL_COMPLAINT","CONTENT_REMOVAL","NCII","UNAUTHORIZED_INTIMATE_AI","UNDERAGE_EXPLOITATION","LIKENESS_IDENTITY","PRIVACY","COPYRIGHT_DMCA","ACCOUNT_APPEAL","LEGAL_REGULATORY","OTHER_SAFETY"] as const;
export const SAFETY_STATES=["RECEIVED","TRIAGED","INFORMATION_NEEDED","UNDER_REVIEW","ESCALATED","ACTION_PENDING","ACTIONED","NOTIFIED","APPEAL_OR_COUNTERNOTICE","CLOSED"] as const;
export const REPORTER_TYPES=["AFFECTED_PERSON","AUTHORIZED_REPRESENTATIVE","PARENT_GUARDIAN","RIGHTS_HOLDER","ACCOUNT_HOLDER","ATTORNEY","LAW_ENFORCEMENT_REGULATOR","WITNESS_OTHER"] as const;
export const REASON_CODES=["SAFETY","UNDERAGE_REPORT","NONCONSENSUAL","LIKENESS","PRIVACY","COPYRIGHT_DMCA","PLATFORM_POLICY","ACCOUNT_APPEAL","LEGAL_PROCESS","INSUFFICIENT_INFORMATION"] as const;
export type SafetyCategory=typeof SAFETY_CATEGORIES[number];
export function bounded(value:unknown,min:number,max:number){if(typeof value!=="string")return null;const v=value.trim();return v.length>=min&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v)?v:null}
export function optionalBounded(value:unknown,max:number){if(value===undefined||value===null||value==="")return null;return bounded(value,1,max)}
export function validEmail(value:unknown){const v=optionalBounded(value,254);return v&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)?v:null}
export async function createPublicSafetyCase(input:Record<string,unknown>){
 const {data,error}=await getSupabaseAdmin().rpc("create_public_safety_case",{p_category:input.category,p_reporter_type:input.reporterType,p_contact_email:input.contactEmail??null,p_affected_reference:input.affectedReference??null,p_content_url:input.contentUrl??null,p_description:input.description,p_requested_action:input.requestedAction??null,p_affected_person_declaration:input.affectedPersonDeclaration??null,p_good_faith:input.goodFaith===true});
 return error||typeof data!=="string"?null:data;
}
export async function listSafetyCases(actorUserId:string,state:string|null,before:string|null,beforeId:string|null,limit:number){const{data,error}=await getSupabaseAdmin().rpc("list_admin_safety_cases",{p_actor_user_id:actorUserId,p_state:state,p_before:before,p_before_id:beforeId,p_limit:limit});return error?null:data}
export async function getSafetyCase(actorUserId:string,caseRef:string){const{data,error}=await getSupabaseAdmin().rpc("get_admin_safety_case",{p_actor_user_id:actorUserId,p_case_ref:caseRef});return error?null:data}
export async function transitionSafetyCase(actorUserId:string,caseRef:string,toState:string,reasonCode:string,reason:string,outcome:string|null){const{error}=await getSupabaseAdmin().rpc("transition_admin_safety_case",{p_actor_user_id:actorUserId,p_case_ref:caseRef,p_to_state:toState,p_reason_code:reasonCode,p_reason:reason,p_outcome_summary:outcome});return !error}
