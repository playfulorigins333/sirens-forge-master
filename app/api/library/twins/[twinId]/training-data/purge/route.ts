import { handleTwinLifecycleOperation } from "../../lifecycleRoute";
export async function POST(_request: Request, context: { params: Promise<{ twinId: string }> }) { return handleTwinLifecycleOperation("purge-training-data", context); }
