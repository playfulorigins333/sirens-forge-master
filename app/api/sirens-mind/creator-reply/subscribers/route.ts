import { NextRequest, NextResponse } from "next/server"
import { requireCreatorReplyActor } from "@/lib/sirens-mind/creator-reply-access"
import { createSubscriber, listSubscribers } from "@/lib/sirens-mind/creator-reply-service"
export async function GET(req:NextRequest){const {userId}=await requireCreatorReplyActor();return NextResponse.json({subscribers:await listSubscribers(userId,req.nextUrl.searchParams.get("archived")==="true")})}
export async function POST(req:NextRequest){const {userId}=await requireCreatorReplyActor();try{return NextResponse.json(await createSubscriber(userId,await req.json()),{status:201})}catch{return NextResponse.json({error:"Subscriber could not be saved."},{status:400})}}
