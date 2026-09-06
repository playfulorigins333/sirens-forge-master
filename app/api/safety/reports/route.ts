import { createPublicSafetyCase } from "@/lib/safety/cases";
import { handleSafetyReport } from "@/lib/safety/intakeRouteCore";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  return handleSafetyReport(req, createPublicSafetyCase);
}
