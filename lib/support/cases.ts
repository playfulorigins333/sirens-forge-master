import "server-only"
import { supabaseServer } from "@/lib/supabaseServer"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"

export const SUPPORT_STATUSES=["open","in_progress","waiting_for_creator","resolved","closed"] as const
export const SUPPORT_CATEGORIES=["account","security","generation","technical","other"] as const
export function boundedText(value:unknown,min:number,max:number){if(typeof value!=="string")return null;const v=value.trim();return v.length>=min&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v)?v:null}
export async function createOwnCase(category:string,summary:string){const {data,error}=await (await supabaseServer()).rpc("create_own_support_case",{p_category:category,p_summary:summary});return error?null:String(data)}
export async function listOwnCases(before:string|null,beforeId:string|null,limit:number){const {data,error}=await (await supabaseServer()).rpc("list_own_support_cases",{p_before:before,p_before_id:beforeId,p_limit:limit});return error?null:data??[]}
export async function listAdminCases(actorUserId:string,status:string|null,before:string|null,beforeId:string|null,limit:number){const {data,error}=await getSupabaseAdmin().rpc("list_admin_support_cases",{p_actor_user_id:actorUserId,p_status:status,p_before:before,p_before_id:beforeId,p_limit:limit});return error?null:data??[]}
export async function transitionAdminCase(actorUserId:string,caseId:string,status:string,note:string|null){const {error}=await getSupabaseAdmin().rpc("transition_admin_support_case",{p_actor_user_id:actorUserId,p_case_id:caseId,p_status:status,p_note:note});return !error}
