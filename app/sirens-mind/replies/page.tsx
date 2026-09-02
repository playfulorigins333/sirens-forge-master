import { notFound } from "next/navigation"
import ChatUI from "@/components/chat/ChatUI"
import { ensureActiveSubscription } from "@/lib/subscription-checker"
import { creatorReplyAuthorized } from "@/lib/sirens-mind/creator-reply"

export default async function CreatorRepliesPage() {
  const auth = await ensureActiveSubscription()
  if (!auth.ok || !auth.user?.id || !creatorReplyAuthorized(auth.user.id)) notFound()
  return <ChatUI experience="creator_reply" />
}
