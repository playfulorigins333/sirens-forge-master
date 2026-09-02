import "server-only"
import { notFound } from "next/navigation"
import { ensureActiveSubscription } from "../subscription-checker"
import { creatorReplyAccessAllowed } from "./creator-reply"

export async function requireCreatorReplyActor() {
  const auth = await ensureActiveSubscription()
  if (!auth.ok || !auth.user?.id || !creatorReplyAccessAllowed(auth.user.id)) notFound()
  return { userId: auth.user.id }
}
