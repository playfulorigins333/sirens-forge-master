import { NextResponse } from "next/server";
import { isGenerationExecutionEnabled } from "../../../../lib/generation/executionAvailability";
import { isDurableComputeJobsEnabled } from "../../../../lib/compute-jobs";
import { isPrivateCreatorMediaEnabled } from "../../../../lib/private-creator-media/core";
export const dynamic = "force-dynamic";
export function GET() {
  const durable = isDurableComputeJobsEnabled();
  return NextResponse.json({
    available: durable ? isPrivateCreatorMediaEnabled() : isGenerationExecutionEnabled(),
    execution_mode: durable ? "durable" : "synchronous",
  });
}
