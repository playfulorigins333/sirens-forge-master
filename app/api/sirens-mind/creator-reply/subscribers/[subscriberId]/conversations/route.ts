import { NextRequest, NextResponse } from "next/server"
import { requireCreatorReplyActor } from "@/lib/sirens-mind/creator-reply-access"
import { conversations, newConversation } from "@/lib/sirens-mind/creator-reply-service"
export async function GET(_:NextRequest,{params}:{params:Promise<{subscriberId:string}>}){const [{userId},p]=await Promise.all([requireCreatorReplyActor(),params]);try{return NextResponse.json({conversations:await conversations(userId,p.subscriberId)})}catch{return NextResponse.json({error:"Not found"},{status:404})}}
export async function POST(_:NextRequest,{params}:{params:Promise<{subscriberId:string}>}){const [{userId},p]=await Promise.all([requireCreatorReplyActor(),params]);try{return NextResponse.json({conversation:await newConversation(userId,p.subscriberId)},{status:201})}catch{return NextResponse.json({error:"Not found"},{status:404})}}
