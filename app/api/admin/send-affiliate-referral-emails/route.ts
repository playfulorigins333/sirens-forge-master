import { NextResponse } from "next/server";
import { Resend } from "resend";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST() {
  try {
    // 🚨 CREATE CLIENTS INSIDE HANDLER ONLY
    const supabase = getSupabaseAdmin();

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json(
        { error: "RESEND_API_KEY not configured" },
        { status: 500 }
      );
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    const { data: users, error } = await supabase
      .from("profiles")
      .select("id, email, referral_code")
      .not("referral_code", "is", null)
      .is("referral_email_sent_at", null);

    if (error) {
      console.error("❌ Failed to fetch users:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let sent = 0;
    const failed: any[] = [];

    for (const user of users || []) {
      try {
        if (!user.email) {
          failed.push({ id: user.id, error: "Missing email" });
          continue;
        }

        const res = await resend.emails.send({
          from: "Sirens Forge <noreply@sirensforge.vip>",
          to: user.email,
          subject: "Your Sirens Forge referral code — we’re almost there",
          html: `
            <p>Hey,</p>
            <p>Your referral code:</p>
            <p><strong>${user.referral_code}</strong></p>
            <p>
              <a href="https://sirensforge.vip/pricing?ref=${user.referral_code}">
                https://sirensforge.vip/pricing?ref=${user.referral_code}
              </a>
            </p>
            <p>🧡<br/>Dustin & Allison</p>
          `,
        });

        if (!res.error) {
          await supabase
            .from("profiles")
            .update({ referral_email_sent_at: new Date().toISOString() })
            .eq("id", user.id);

          sent++;
        } else {
          failed.push({ email: user.email, error: res.error });
        }

        await sleep(1200);
      } catch (err) {
        failed.push({ email: user.email, error: err });
      }
    }

    return NextResponse.json({
      attempted: users?.length || 0,
      sent,
      failed,
    });
  } catch (err: any) {
    console.error("🔥 Referral email job failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}
