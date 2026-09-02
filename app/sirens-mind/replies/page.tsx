import { notFound } from "next/navigation"
import CreatorReplyWorkspace from "@/components/chat/CreatorReplyWorkspace"
import { ensureActiveSubscription } from "@/lib/subscription-checker"
import { creatorReplyAccessAllowed } from "@/lib/sirens-mind/creator-reply"

export default async function CreatorRepliesPage() {
  // creatorReplyAccessAllowed centralizes the existing creatorReplyAuthorized policy.
  const auth = await ensureActiveSubscription()
  if (!auth.ok || !auth.user?.id || !creatorReplyAccessAllowed(auth.user.id)) notFound()
  return <CreatorReplyWorkspace />
}
