import { notFound } from "next/navigation"
import CreatorReplyWorkspace from "@/components/chat/CreatorReplyWorkspace"
import { ensureActiveSubscription } from "@/lib/subscription-checker"
import { creatorReplyAccessAllowed } from "@/lib/sirens-mind/creator-reply"

export default async function CreatorRepliesPage() {
  // creatorReplyAccessAllowed centralizes the existing creatorReplyAuthorized policy.
  const auth = await ensureActiveSubscription()
  if (!auth.ok || !auth.user?.id || !creatorReplyAccessAllowed(auth.user.id)) notFound()
  return (
    <div data-creator-reply-page className="h-dvh overflow-hidden">
      <style>{`
        [data-creator-reply-page] > div {
          height: 100%;
          min-height: 0 !important;
        }
        [data-creator-reply-page] > div > main {
          height: 100%;
          min-height: 0 !important;
          overflow: hidden;
        }
        [data-creator-reply-page] section[class*="min-h-[32rem]"] {
          min-height: 0 !important;
        }
      `}</style>
      <CreatorReplyWorkspace />
    </div>
  )
}
