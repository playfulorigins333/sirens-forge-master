export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { handleLibraryLifecycleOperation } from "../lifecycleRoute";

export async function POST(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  return handleLibraryLifecycleOperation("restore", context);
}
