import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
export async function POST(_: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const { jobId } = await params;
  const { data, error } = await getSupabaseAdmin().rpc("cancel_compute_job", { p_owner_id: user.id, p_job_id: jobId });
  if (error) return NextResponse.json({ error: "COMPUTE_JOB_NOT_FOUND" }, { status: 404 });
  const state = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ job_id: jobId, status: state === "cancel_requested" ? "cancelling" : state });
}
