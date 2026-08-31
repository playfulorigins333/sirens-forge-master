import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().from("user_loras")
    .select("id,name,artifact_r2_bucket,artifact_r2_key,trigger_token,created_at")
    .eq("user_id", user.id).eq("status", "completed").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "IDENTITIES_UNAVAILABLE" }, { status: 503 });
  const identities = (data ?? []).filter((row: any) =>
    row.artifact_r2_bucket?.trim() && row.artifact_r2_key?.trim() && row.trigger_token?.trim()
  ).map((row: any) => ({ id: row.id, name: row.name ?? null }));
  return NextResponse.json({ identities }, { headers: { "Cache-Control": "no-store" } });
}
