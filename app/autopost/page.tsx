import { redirect } from "next/navigation";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { randomUUID } from "node:crypto";
import AutopostPageClient from "./AutopostPageClient";
import { Task14AutopostOrchestration } from "./Task14AutopostOrchestration";
import { loadAutopostCapabilities, loadAutopostPackageOptions } from "@/lib/creator-publishing-queue/autopost/service";

export default async function AutopostPage() {
  const auth = await ensureActiveSubscription();

  if (!auth.ok) {
    if (auth.error === "UNAUTHENTICATED") {
      redirect("/login");
    } else {
      redirect("/pricing");
    }
  }

  const [capabilities, packages] = await Promise.all([loadAutopostCapabilities(), loadAutopostPackageOptions()]);

  return (
    <>
      <AutopostPageClient />
      <Task14AutopostOrchestration capabilities={capabilities} packages={packages} idempotencyKey={randomUUID().replaceAll("-", "_")} />
    </>
  );
}
