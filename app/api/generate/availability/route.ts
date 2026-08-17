import { NextResponse } from "next/server";
import { isGenerationExecutionEnabled } from "../../../../lib/generation/executionAvailability";
export const dynamic = "force-dynamic";
export function GET() { return NextResponse.json({ available: isGenerationExecutionEnabled() }); }
