import { NextResponse } from "next/server";
import { isGenerationExecutionEnabled } from "../../../../lib/generation/executionAvailability";
import { isDurableComputeJobsEnabled } from "../../../../lib/compute-jobs";
import { isPrivateCreatorMediaDeliveryReady } from "../../../../lib/private-creator-media/r2Config";
export const dynamic = "force-dynamic";
export function GET() {
  const durable = isDurableComputeJobsEnabled();
  return NextResponse.json({
    available: durable ? isPrivateCreatorMediaDeliveryReady() : isGenerationExecutionEnabled(),
    execution_mode: durable ? "durable" : "synchronous",
  });
}
