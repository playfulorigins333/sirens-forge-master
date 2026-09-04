import { NextResponse } from "next/server";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { UUID_RE } from "@/lib/private-creator-media/core";
import { TwinLifecycleError, purgeTwin, purgeTwinTrainingData, restoreTwin, trashTwin } from "@/lib/twin-lifecycle";

export type TwinLifecycleOperation = "trash" | "restore" | "purge" | "purge-training-data";
const NO_STORE = { "Cache-Control": "no-store" };

export async function handleTwinLifecycleOperation(operation: TwinLifecycleOperation, context: { params: Promise<{ twinId: string }> }) {
  const auth = await ensureActiveSubscription();
  if (!auth.ok || !auth.user?.id) {
    return NextResponse.json({ error: auth.error ?? "UNAUTHENTICATED" }, { status: auth.status ?? 401, headers: NO_STORE });
  }
  const { twinId } = await context.params;
  if (!UUID_RE.test(twinId)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
  try {
    const result = operation === "trash" ? await trashTwin(twinId, auth.user.id)
      : operation === "restore" ? await restoreTwin(twinId, auth.user.id)
      : operation === "purge-training-data" ? await purgeTwinTrainingData(twinId, auth.user.id)
      : await purgeTwin(twinId, auth.user.id);
    return NextResponse.json({ ok: true, result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof TwinLifecycleError) return NextResponse.json({ error: error.code }, { status: error.status, headers: NO_STORE });
    return NextResponse.json({ error: "LIFECYCLE_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
  }
}
