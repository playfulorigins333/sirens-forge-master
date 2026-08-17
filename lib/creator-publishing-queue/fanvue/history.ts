import "server-only";
import { requireActiveCreatorId } from "../creatorEntitlement";
import { getSupabaseAdmin } from "../../supabaseAdmin";
export type FanvueHistoryDto={id:string;content_package_id:string;destination_id:string;publication_type:string;scheduled_at:string;state:string;next_attempt_at:string|null;posted_at:string|null;safe_error_code:string|null;created_at:string;updated_at:string;attempts:Array<{attempt_ordinal:number;started_at:string;provider_create_dispatched_at:string|null;finished_at:string|null;outcome_class:string|null;safe_error_code:string|null}>};
const JOB_FIELDS="id,content_package_id,destination_id,publication_type,scheduled_at,state,next_attempt_at,posted_at,safe_error_code,created_at,updated_at";
const ATTEMPT_FIELDS="attempt_ordinal,started_at,provider_create_dispatched_at,finished_at,outcome_class,safe_error_code";
export async function loadCreatorFanvueHistory():Promise<FanvueHistoryDto[]> {
  const creatorId=await requireActiveCreatorId(); const admin=getSupabaseAdmin();
  const {data,error}=await admin.from("creator_publishing_fanvue_history").select(JOB_FIELDS).eq("creator_id",creatorId).order("created_at",{ascending:false});
  if(error) throw new Error("FANVUE_HISTORY_UNAVAILABLE");
  return Promise.all((data??[]).map(async row=>{const {data:attempts}=await admin.from("creator_publishing_fanvue_attempts").select(ATTEMPT_FIELDS).eq("job_id",row.id).eq("creator_id",creatorId).order("attempt_ordinal");return {...row,attempts:attempts??[]} as FanvueHistoryDto;}));
}
