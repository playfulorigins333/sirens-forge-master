import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { toCreatorComputeStatus } from "@/lib/compute-jobs";
import { loadCreatorImageResult } from "@/lib/generation/durableImageResult";
import { UUID_RE } from "@/lib/private-creator-media/core";

async function owner() {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  return user?.id ?? null;
}
export async function GET(_: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const ownerId = await owner(); if (!ownerId) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const { jobId } = await params;
  if (!UUID_RE.test(jobId)) return NextResponse.json({ error: "COMPUTE_JOB_NOT_FOUND" }, { status: 404 });
  const canonicalJobId = jobId.toLowerCase();
  const { data, error } = await getSupabaseAdmin().rpc("creator_compute_status", { p_owner_id: ownerId, p_job_id: canonicalJobId });
  const row = Array.isArray(data) ? data[0] : data;
  if (error) return NextResponse.json({ error: "COMPUTE_STATUS_UNAVAILABLE" }, { status: 503 });
  if (!row) return NextResponse.json({ error: "COMPUTE_JOB_NOT_FOUND" }, { status: 404 });
  const status = toCreatorComputeStatus(row);
  if (status.status === "completed" && status.workload === "image") {
    const imageResult = await loadCreatorImageResult(getSupabaseAdmin(), ownerId, canonicalJobId, status.result_reference);
    if (!imageResult) return NextResponse.json({ error: "IMAGE_RESULT_UNAVAILABLE" }, { status: 409 });
    return NextResponse.json({ ...status, image_result: imageResult });
  }
  return NextResponse.json(status);
}
