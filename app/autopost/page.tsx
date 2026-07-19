import { redirect } from "next/navigation";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { randomUUID } from "node:crypto";
import AutopostPageClient from "./AutopostPageClient";
import { Task14AutopostOrchestration } from "./Task14AutopostOrchestration";
import { loadAutopostCapabilities, loadAutopostPackageOptions } from "@/lib/creator-publishing-queue/autopost/service";
import type { AutopostPackageOption, SafeCapability } from "@/lib/creator-publishing-queue/autopost/types";

type Task14AutopostLoadResult =
  | { ok: true; capabilities: SafeCapability[]; packages: AutopostPackageOption[] }
  | { ok: false };

async function loadTask14AutopostSection(): Promise<Task14AutopostLoadResult> {
  try {
    const [capabilities, packages] = await Promise.all([loadAutopostCapabilities(), loadAutopostPackageOptions()]);
    return { ok: true, capabilities, packages };
  } catch {
    return { ok: false };
  }
}

export default async function AutopostPage() {
  const auth = await ensureActiveSubscription();

  if (!auth.ok) {
    if (auth.error === "UNAUTHENTICATED") {
      redirect("/login");
    } else {
      redirect("/pricing");
    }
  }

  const task14 = await loadTask14AutopostSection();

  return (
    <>
      <AutopostPageClient />
      {task14.ok ? (
        <Task14AutopostOrchestration capabilities={task14.capabilities} packages={task14.packages} idempotencyKey={randomUUID().replaceAll("-", "_")} />
      ) : (
        <section className="relative z-10 mx-auto mt-8 max-w-6xl rounded-3xl border border-cyan-300/20 bg-cyan-950/20 p-5 text-cyan-50">
          <p className="text-sm uppercase tracking-[0.25em] text-cyan-200">Task 14 Creator Publishing Orchestration</p>
          <h2 className="mt-2 text-2xl font-semibold">Autopost orchestration is temporarily unavailable</h2>
          <p className="mt-2 text-sm text-cyan-100">Existing Autopost tools remain available. The new draft Publishing Plan workflow will appear here after its trusted server data is available.</p>
        </section>
      )}
    </>
  );
}
