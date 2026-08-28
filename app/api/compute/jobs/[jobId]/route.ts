import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { toCreatorComputeStatus } from "@/lib/compute-jobs";
import { loadCreatorImageResult } from "@/lib/generation/durableImageResult";

async function owner() {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  return user?.id ?? null;
}
export async function GET(_: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const ownerId = await owner(); if (!ownerId) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const { jobId } = await params;
  const { data, error } = await getSupabaseAdmin().rpc("creator_compute_status", { p_owner_id: ownerId, p_job_id: jobId });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return NextResponse.json({ error: "COMPUTE_JOB_NOT_FOUND" }, { status: 404 });
  const status = toCreatorComputeStatus(row);
  if (status.status === "completed" && status.workload === "image") {
    const imageResult = await loadCreatorImageResult(getSupabaseAdmin(), ownerId, status.result_reference);
    if (!imageResult) return NextResponse.json({ error: "IMAGE_RESULT_UNAVAILABLE" }, { status: 409 });
    return NextResponse.json({ ...status, image_result: imageResult });
  }
  return NextResponse.json(status);
}
