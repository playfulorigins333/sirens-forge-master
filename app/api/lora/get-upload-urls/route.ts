import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { canonicalUuid } from "@/lib/trainer-application-contract";
import { DATASET_LIMITS } from "@/lib/dataset-doctor/dataset-limits";
import { datasetSourceExtension, validDatasetSourceDescriptor } from "@/lib/dataset-doctor/upload-contract";
import { requireSirensApiConfig, sirensApiFetch } from "@/lib/sirensApi";
export const runtime="nodejs";export const dynamic="force-dynamic";
const r2=new S3Client({region:process.env.AWS_DEFAULT_REGION||"auto",endpoint:process.env.R2_ENDPOINT!,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID!,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY!}});
export async function POST(req:Request){
 try{
  const auth=await ensureActiveSubscription();if(!auth.ok)return NextResponse.json({error:auth.error,message:auth.message},{status:auth.status});
  const body=await req.json().catch(()=>null);if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).sort().join(",")!=="images,lora_id")return NextResponse.json({error:"INVALID_UPLOAD_REQUEST"},{status:400});
  const loraId=canonicalUuid((body as any).lora_id),images=(body as any).images;if(!loraId||!Array.isArray(images)||images.length<DATASET_LIMITS.minimumUploadCount||images.length>DATASET_LIMITS.maximumUploadCount||!images.every(validDatasetSourceDescriptor))return NextResponse.json({error:"INVALID_UPLOAD_REQUEST"},{status:400});
  const admin=getSupabaseAdmin();const {data:lora}=await admin.from("user_loras").select("id,user_id").eq("id",loraId).eq("user_id",auth.user.id).maybeSingle();if(!lora)return NextResponse.json({error:"NOT_FOUND"},{status:404});
  const config=requireSirensApiConfig();const created=await sirensApiFetch("/dataset-doctor/jobs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({lora_id:loraId,auto_approve:false})},fetch,config);const payload=await created.json().catch(()=>null);const job=payload?.job,jobId=canonicalUuid(job?.id);const expectedPrefix=jobId?`dataset_doctor/${loraId}/raw/${jobId}`:"";
  if(!created.ok||payload?.success!==true||!jobId||job?.lora_id!==loraId||job?.user_id!==auth.user.id||job?.status!=="uploaded"||typeof job?.raw_r2_bucket!=="string"||!job.raw_r2_bucket.trim()||job.raw_r2_bucket.length>128||job?.raw_r2_prefix!==expectedPrefix)return NextResponse.json({error:"DATASET_JOB_AUTHORITY_INVALID"},{status:502});
  const urls=[];for(const descriptor of images){const ext=datasetSourceExtension(descriptor.mime_type)!;const key=`${expectedPrefix}/${Date.now()}_${randomUUID()}${ext}`;const command=new PutObjectCommand({Bucket:job.raw_r2_bucket,Key:key,ContentType:descriptor.mime_type});const url=await getSignedUrl(r2,command,{expiresIn:600});urls.push({url,key,content_type:descriptor.mime_type});}
  return NextResponse.json({lora_id:loraId,dataset_doctor_job_id:jobId,bucket:job.raw_r2_bucket,prefix:expectedPrefix,urls});
 }catch(error){console.error("[get-upload-urls] failed",error);return NextResponse.json({error:"FAILED_TO_CREATE_UPLOAD"},{status:500});}
}
