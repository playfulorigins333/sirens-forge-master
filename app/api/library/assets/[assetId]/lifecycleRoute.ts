import { NextResponse } from "next/server";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { UUID_RE, isPrivateCreatorMediaEnabled } from "@/lib/private-creator-media/core";
import {
  PrivateMediaLifecycleError,
  purgePrivateGenerationAsset,
  restorePrivateGenerationAsset,
  trashPrivateGenerationAsset,
} from "@/lib/private-creator-media/lifecycle";

export type LibraryLifecycleOperation = "trash" | "restore" | "purge";

const NO_STORE = { "Cache-Control": "no-store" };

export async function handleLibraryLifecycleOperation(
  operation: LibraryLifecycleOperation,
  context: { params: Promise<{ assetId: string }> },
) {
  if (!isPrivateCreatorMediaEnabled()) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
  }

  const auth = await ensureActiveSubscription();
  if (!auth.ok || !auth.user?.id) {
    return NextResponse.json(
      { error: auth.error ?? "UNAUTHENTICATED" },
      { status: auth.status ?? 401, headers: NO_STORE },
    );
  }

  const { assetId } = await context.params;
  if (!UUID_RE.test(assetId)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
  }

  try {
    const result = operation === "trash"
      ? await trashPrivateGenerationAsset(assetId, auth.user.id)
      : operation === "restore"
        ? await restorePrivateGenerationAsset(assetId, auth.user.id)
        : await purgePrivateGenerationAsset(assetId, auth.user.id);

    return NextResponse.json({ ok: true, result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof PrivateMediaLifecycleError) {
      return NextResponse.json({ error: error.code }, { status: error.status, headers: NO_STORE });
    }
    return NextResponse.json({ error: "LIFECYCLE_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
  }
}
