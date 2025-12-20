import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY!);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function POST() {
  const { data: users, error } = await supabase
    .from("profiles")
    .select("id, email, referral_code")
    .not("referral_code", "is", null)
    .is("referral_email_sent_at", null);

  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  let sent = 0;
  let failed: any[] = [];

  for (const user of users || []) {
    try {
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
}
