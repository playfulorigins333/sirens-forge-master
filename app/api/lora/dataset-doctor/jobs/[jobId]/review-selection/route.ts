import { proxyDatasetDoctorOperation } from "@/lib/datasetDoctorProxy";
export const runtime="nodejs";export const dynamic="force-dynamic";
export function POST(request:Request,{params}:{params:Promise<{jobId:string}>}){return params.then(({jobId})=>proxyDatasetDoctorOperation(request,jobId,"review-selection"));}
