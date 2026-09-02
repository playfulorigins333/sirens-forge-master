import { NextRequest, NextResponse } from "next/server"
import { requireCreatorReplyActor } from "@/lib/sirens-mind/creator-reply-access"
import { renameConversation } from "@/lib/sirens-mind/creator-reply-service"
export async function PATCH(req:NextRequest,{params}:{params:Promise<{conversationId:string}>}){const[{userId},p,body]=await Promise.all([requireCreatorReplyActor(),params,req.json()]);try{return NextResponse.json({conversation:await renameConversation(userId,p.conversationId,body.label)})}catch(error){const code=error instanceof Error?error.message:"";return NextResponse.json({error:code==="NOT_FOUND"?"Not found":"Conversation could not be renamed."},{status:code==="NOT_FOUND"?404:code.includes("CONFLICT")?409:code==="INVALID_INPUT"?400:500})}}
