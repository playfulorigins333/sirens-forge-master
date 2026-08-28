export const DATASET_DOCTOR_ANALYSIS_VERSION=4 as const;
export const DATASET_DOCTOR_MODE="dataset_doctor_quality_v1" as const;
export const DATASET_DOCTOR_QUALITY_VERSION="dataset-doctor-quality-v1" as const;
export const DATASET_DOCTOR_REVIEW_VERSION="dataset-doctor-review-selection-v1" as const;
export const QUALITY_WARNING_CODES=Object.freeze(["insufficient_closeups","insufficient_midshots","insufficient_fullbody","closeup_overrepresented","fullbody_overrepresented","midshot_overrepresented","dataset_unbalanced","too_many_side_profiles","low_resolution_images_present","face_detection_uncertain_present","small_dataset_recommended_more_images","exact_duplicates_removed"] as const);
export const QUALITY_ISSUE_CODES=Object.freeze(["too_few_accepted_images","weak_identity_signal","missing_closeups","missing_midshots","missing_fullbody","closeup_overrepresented","low_average_quality","face_detection_uncertain_present","low_resolution_images_present","too_many_side_profiles"] as const);
export const PUBLIC_QUALITY_KEYS=Object.freeze(["accepted_count","balance_score","composition_balance","composition_summary","confidence_message","confidence_signal","dataset_grade","dataset_quality_score","dataset_ready","dataset_strengths","dataset_warnings","dataset_warnings_structured","guidance","primary_issue","priority_guidance","rejected_count","secondary_issues","shot_suggestions","training_prediction"] as const);
const TOP_KEYS=["accepted_count","analysis_version","balance_score","composition_balance","composition_summary","confidence_message","confidence_signal","dataset_grade","dataset_quality_score","dataset_ready","dataset_strengths","dataset_warnings","dataset_warnings_structured","guidance","mode","primary_issue","priority_guidance","quality_contract_version","raw_count","rebuild_from_r2","rejected_count","review_count","review_selection","secondary_issues","shot_suggestions","training_prediction","needs_more_images","missing_coverage"];
const REVIEW_KEYS=["contract_version","evidence_fingerprint","image_count","image_ids","quality_fingerprint","quality_summary","selection_fingerprint"];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;const SHA=/^[0-9a-f]{64}$/;const warnings=new Set<string>(QUALITY_WARNING_CODES),issues=new Set<string>(QUALITY_ISSUE_CODES);
export type ReviewSelection={contract_version:string;image_ids:string[];image_count:number;selection_fingerprint:string;evidence_fingerprint:string;quality_summary:Record<string,unknown>;quality_fingerprint:string};
export type SelectedAuthority={analysis_version:4;mode:typeof DATASET_DOCTOR_MODE;quality_contract_version:typeof DATASET_DOCTOR_QUALITY_VERSION;review_selection:ReviewSelection};
function exactKeys(v:Record<string,unknown>,keys:readonly string[]){return Object.keys(v).sort().join("|")=== [...keys].sort().join("|")}
function stringArray(v:unknown){return Array.isArray(v)&&v.every(x=>typeof x==="string")}
export function validateReviewSelection(summary:unknown):SelectedAuthority|null{
 if(!summary||typeof summary!=="object"||Array.isArray(summary))return null;const top=summary as Record<string,unknown>;
 if(!exactKeys(top,TOP_KEYS)||top.analysis_version!==4||top.mode!==DATASET_DOCTOR_MODE||top.quality_contract_version!==DATASET_DOCTOR_QUALITY_VERSION)return null;
 const raw=top.review_selection;if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;const r=raw as Record<string,unknown>;
 if(!exactKeys(r,REVIEW_KEYS)||r.contract_version!==DATASET_DOCTOR_REVIEW_VERSION||!Array.isArray(r.image_ids)||!Number.isInteger(r.image_count)||Number(r.image_count)<3||Number(r.image_count)>100||r.image_count!==r.image_ids.length)return null;
 const ids=r.image_ids;if(!ids.every(x=>typeof x==="string"&&UUID.test(x))||new Set(ids).size!==ids.length||ids.some((x,i)=>i>0&&ids[i-1]>=x))return null;
 if(![r.selection_fingerprint,r.evidence_fingerprint,r.quality_fingerprint].every(x=>typeof x==="string"&&SHA.test(x)))return null;
 const q=r.quality_summary;if(!q||typeof q!=="object"||Array.isArray(q)||!exactKeys(q as Record<string,unknown>,PUBLIC_QUALITY_KEYS))return null;const quality=q as Record<string,unknown>;
 if(!Number.isInteger(quality.accepted_count)||quality.accepted_count!==r.image_count||quality.rejected_count!==0||typeof quality.dataset_ready!=="boolean"||typeof quality.dataset_quality_score!=="number"||typeof quality.balance_score!=="number")return null;
 const cb=quality.composition_balance;if(!cb||typeof cb!=="object"||Array.isArray(cb)||!["missing","underrepresented","overrepresented"].every(k=>stringArray((cb as Record<string,unknown>)[k])))return null;
 if(!stringArray(quality.dataset_warnings)||!(quality.dataset_warnings as string[]).every(x=>warnings.has(x))||!stringArray(quality.secondary_issues)||!(quality.secondary_issues as string[]).every(x=>issues.has(x)))return null;
 if(!(quality.primary_issue==null||quality.primary_issue===""||typeof quality.primary_issue==="string"&&issues.has(quality.primary_issue)))return null;
 const sw=quality.dataset_warnings_structured;if(!Array.isArray(sw)||sw.some(x=>!x||typeof x!=="object"||Array.isArray(x)||!exactKeys(x as Record<string,unknown>,["category","overridable","type"])||(x as any).category!=="quality"||(x as any).overridable!==true||!warnings.has((x as any).type)))return null;
 const flat=[...(quality.dataset_warnings as string[])].sort(),structured=sw.map(x=>(x as any).type as string).sort();if(JSON.stringify(flat)!==JSON.stringify(structured))return null;
 return {analysis_version:4,mode:DATASET_DOCTOR_MODE,quality_contract_version:DATASET_DOCTOR_QUALITY_VERSION,review_selection:r as unknown as ReviewSelection};
}
export function selectedQualityState(authority:SelectedAuthority|null):"ready"|"overridable"|"prohibited"{if(!authority)return"prohibited";const q=authority.review_selection.quality_summary;if(q.dataset_ready===true)return"ready";const has=(q.dataset_warnings as unknown[]).length||(q.secondary_issues as unknown[]).length||Boolean(q.primary_issue)||(q.guidance as unknown[])?.length||(q.priority_guidance as unknown[])?.length;return has?"overridable":"prohibited"}
export function sameSelectedIds(ids:string[],authority:SelectedAuthority|null){return Boolean(authority)&&JSON.stringify([...ids].sort())===JSON.stringify(authority!.review_selection.image_ids)}
