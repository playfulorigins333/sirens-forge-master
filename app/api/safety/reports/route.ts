import {NextResponse} from "next/server";
import {bounded,createPublicSafetyCase,optionalBounded,REPORTER_TYPES,SAFETY_CATEGORIES,validEmail} from "@/lib/safety/cases";
export const dynamic="force-dynamic";const headers={"Cache-Control":"no-store",Pragma:"no-cache"};const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});
const allowed=["category","reporterType","contactEmail","affectedReference","contentUrl","description","requestedAction","affectedPersonDeclaration","goodFaith"];
export async function POST(req:Request){
 if(req.headers.get("content-type")?.split(";",1)[0].trim().toLowerCase()!=="application/json")return json({ok:false,code:"REPORT_CONTENT_TYPE_INVALID"},415);
 const declared=Number(req.headers.get("content-length"));if(Number.isFinite(declared)&&declared>16384)return json({ok:false,code:"REPORT_TOO_LARGE"},413);
 const raw=await req.text();if(new TextEncoder().encode(raw).byteLength>16384)return json({ok:false,code:"REPORT_TOO_LARGE"},413);
 let value:unknown;try{value=JSON.parse(raw)}catch{return json({ok:false,code:"REPORT_INVALID"},400)}
 if(!value||typeof value!=="object"||Array.isArray(value))return json({ok:false,code:"REPORT_INVALID"},400);const x=value as Record<string,unknown>;
 if(Object.keys(x).some(k=>!allowed.includes(k))||!SAFETY_CATEGORIES.includes(x.category as never)||!REPORTER_TYPES.includes(x.reporterType as never))return json({ok:false,code:"REPORT_INVALID"},400);
 const description=bounded(x.description,20,4000),contactEmail=validEmail(x.contactEmail),affectedReference=optionalBounded(x.affectedReference,500),contentUrl=optionalBounded(x.contentUrl,1000),requestedAction=optionalBounded(x.requestedAction,1000),declaration=optionalBounded(x.affectedPersonDeclaration,80);
 if(!description||(x.contactEmail!=null&&!contactEmail)||(x.affectedReference!=null&&!affectedReference)||(x.contentUrl!=null&&(!contentUrl||!/^https?:\/\//i.test(contentUrl)))||(x.requestedAction!=null&&!requestedAction)||(x.affectedPersonDeclaration!=null&&!declaration)||x.goodFaith!==true)return json({ok:false,code:"REPORT_INVALID"},400);
 if((["NCII","UNAUTHORIZED_INTIMATE_AI"] as string[]).includes(x.category as string)&&(!declaration||!["AFFECTED_PERSON","AUTHORIZED_REPRESENTATIVE"].includes(declaration)))return json({ok:false,code:"REPORT_INVALID"},400);
 try{const caseReference=await createPublicSafetyCase({...x,description,contactEmail,affectedReference,contentUrl,requestedAction,affectedPersonDeclaration:declaration});return caseReference?json({ok:true,caseReference},201):json({ok:false,code:"REPORT_UNAVAILABLE"},503)}catch{return json({ok:false,code:"REPORT_UNAVAILABLE"},503)}
}
