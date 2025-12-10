// app/api/generate/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "server_not_configured" },
        { status: 500 }
      );
    }

    // -----------------------------
    // 🔐 1. Read auth cookies
    // -----------------------------
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("sb-access-token")?.value || null;

    if (!accessToken) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }

    // -----------------------------
    // 🔐 2. Auth lookup must use ANON client
    // -----------------------------
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const {
      data: { user },
      error: userErr,
    } = await supabaseAuth.auth.getUser(accessToken);

    if (userErr || !user) {
      return NextResponse.json(
        { error: "not_authenticated" },
        { status: 401 }
      );
    }

    // -----------------------------
    // 🔐 3. DB access must use SERVICE ROLE
    // -----------------------------
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch profile (internal mapping)
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, email, badge, is_og_member, seat_number")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json(
        { error: "profile_not_found" },
        { status: 400 }
      );
    }

    // -----------------------------
    // 🔐 4. Subscription check
    // MUST MATCH auth.users.id (NOT profile.id)
    // -----------------------------
    const { data: subscription } = await supabase
      .from("user_subscriptions")
      .select("id, status, tier_name, expires_at")
      .eq("user_id", user.id) // FIXED
      .in("status", ["active", "trialing"])
      .maybeSingle();

    const active =
      subscription &&
      (subscription.status === "active" ||
        subscription.status === "trialing");

    if (!active) {
      return NextResponse.json(
        {
          error:
            "No active SirensForge subscription. Unlock OG, Early Bird, or Prime to generate.",
        },
        { status: 402 }
      );
    }

    // -----------------------------
    // 💬 5. Parse incoming request
    // -----------------------------
    const body = await req.json();
    const prompt = body.prompt;

    if (!prompt) {
      return NextResponse.json(
        { error: "missing_prompt" },
        { status: 400 }
      );
    }

    // -----------------------------
    // 🚀 6. TODO: Send job to RunPod / ComfyUI / Worker
    // -----------------------------
    return NextResponse.json(
      {
        success: true,
        ready: true,
        message: "Subscription active — ready to generate.",
        subscription: subscription.tier_name,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("GENERATION ERROR:", err);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 }
    );
  }
}
