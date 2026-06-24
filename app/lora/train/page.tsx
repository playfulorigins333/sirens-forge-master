import { redirect } from "next/navigation";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import TrainPageClient from "./TrainPageClient";

export default async function TrainPage() {
  const auth = await ensureActiveSubscription();

  if (!auth.ok) {
    if (auth.error === "UNAUTHENTICATED") {
      redirect("/login");
    } else {
      redirect("/pricing");
    }
  }

  return <TrainPageClient />;
}
