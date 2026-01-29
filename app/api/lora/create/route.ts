import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Extract access token from Supabase cookies (Next 15 compatible).
 * MUST await cookies().
 */
async function getAccessTokenFromCookies(): Promise<string | null> {
  const jar = await cookies();

  // 1) Direct modern tokens
  const direct =
    jar.get("sb-access-token")?.value ||
    jar.get("supabase-access-token")?.value;

  if (direct) return direct;

  // 2) Older auth-helpers style: sb-<project>-auth-token
  const all = jar.getAll();
  const authCookie = all.find((c) => c.name.endsWith("-auth-token"));
  if (!authCookie?.value) return null;

  const raw = authCookie.value;

  try {
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed) && typeof parsed[0] === "string") {
      return parsed[0];
    }

    if (parsed && typeof parsed.access_token === "string") {
      return parsed.access_token;
    }
  } catch {
    try {
      const decoded = decodeURIComponent(raw);
      const parsed2 = JSON.parse(decoded);

      if (Array.isArray(parsed2) && typeof parsed2[0] === "string") {
        return parsed2[0];
      }

      if (parsed2 && typeof parsed2.access_token === "string") {
        return parsed2.access_token;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    // ✅ FIX: await cookies()
    const accessToken = await getAccessTokenFromCookies();
    if (!accessToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: userRes, error: userErr } =
      await supabaseAdmin.auth.getUser(accessToken);

    if (userErr || !userRes?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = userRes.user.id;

    const body = await req.json();
    const { identityName, description } = body || {};

    // 1️⃣ Existing draft for THIS USER only
    const { data: existingDraft } = await supabaseAdmin
      .from("user_loras")
      .select("id, status")
      .eq("status", "draft")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingDraft) {
      return NextResponse.json({
        lora_id: existingDraft.id,
        reused: true,
        status: "draft",
      });
    }

    // 2️⃣ Create draft WITH user_id (this fixes the trainer forever)
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("user_loras")
      .insert({
        user_id: userId,
        status: "draft",
        image_count: 0,
        identity_name: identityName ?? null,
        description: description ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.error("[lora/create] Insert failed:", insertErr);
      return NextResponse.json(
        { error: "Failed to create LoRA draft" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      lora_id: inserted.id,
      reused: false,
      status: "draft",
    });
  } catch (err) {
    console.error("[lora/create] Fatal:", err);
    return NextResponse.json(
      { error: "Failed to create LoRA draft" },
      { status: 500 }
    );
  }
}
