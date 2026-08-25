import { NextResponse } from "next/server";
import { isGenerationExecutionEnabled } from "../../../../lib/generation/executionAvailability";
import { isDurableComputeJobsEnabled } from "../../../../lib/compute-jobs";
export const dynamic = "force-dynamic";
export function GET() { return NextResponse.json({ available: isGenerationExecutionEnabled(), execution_mode: isDurableComputeJobsEnabled() ? "durable" : "synchronous" }); }
