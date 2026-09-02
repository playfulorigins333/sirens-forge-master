import { NextRequest, NextResponse } from "next/server"
import { requireCreatorReplyActor } from "@/lib/sirens-mind/creator-reply-access"
import { createSubscriber, listSubscribers } from "@/lib/sirens-mind/creator-reply-service"
export async function GET(req:NextRequest){const {userId}=await requireCreatorReplyActor();return NextResponse.json({subscribers:await listSubscribers(userId,req.nextUrl.searchParams.get("archived")==="true")})}
export async function POST(req:NextRequest){const {userId}=await requireCreatorReplyActor();try{return NextResponse.json(await createSubscriber(userId,await req.json()),{status:201})}catch(error){const code=error instanceof Error?error.message:"";return NextResponse.json({error:code==="INVALID_INPUT"?"Invalid subscriber input.":"Subscriber could not be saved."},{status:code==="INVALID_INPUT"?400:500})}}
