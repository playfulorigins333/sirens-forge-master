import {NextResponse} from "next/server";
import {AGE_ATTESTATION_COOKIE,safeAgeReturnPath} from "@/proxy";

export async function POST(req:Request){
  const type=req.headers.get("content-type")?.split(";",1)[0].trim().toLowerCase();
  if(type!=="application/x-www-form-urlencoded") return NextResponse.json({ok:false,code:"AGE_ATTESTATION_INVALID"},{status:415,headers:{"Cache-Control":"no-store"}});
  const raw=await req.text();
  if(new TextEncoder().encode(raw).byteLength>2048) return NextResponse.json({ok:false,code:"AGE_ATTESTATION_INVALID"},{status:413,headers:{"Cache-Control":"no-store"}});
  const form=new URLSearchParams(raw); if([...form.keys()].some(k=>k!=="next")||form.getAll("next").length>1) return NextResponse.json({ok:false,code:"AGE_ATTESTATION_INVALID"},{status:400,headers:{"Cache-Control":"no-store"}});
  const response=NextResponse.redirect(new URL(safeAgeReturnPath(form.get("next")),req.url),303);
  response.headers.set("Cache-Control","no-store");
  response.cookies.set(AGE_ATTESTATION_COOKIE,"1",{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:60*60*24*180});
  return response;
}
