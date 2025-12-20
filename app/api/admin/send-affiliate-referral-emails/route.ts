import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

/*
FINAL LOCKED VERSION
Admin-only route protected by ADMIN_EMAIL_TOKEN
*/

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY!);

export async function POST(req: Request) {
  try {
    /* ─────────────────────────────────────────────
       ADMIN AUTH (RE-ENABLED)
    ───────────────────────────────────────────── */
    const authHeader = req.headers.get("authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "").trim();

    if (token !== process.env.ADMIN_EMAIL_TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    /* ─────────────────────────────────────────────
       FETCH AFFILIATE USERS
    ───────────────────────────────────────────── */
    const { data: users, error } = await supabase
      .from("profiles")
      .select("email, referral_code")
      .not("referral_code", "is", null);

    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json(
        { error: "Failed to fetch affiliate users" },
        { status: 500 }
      );
    }

    if (!users || users.length === 0) {
      return NextResponse.json(
        { message: "No affiliate users found" },
        { status: 200 }
      );
    }

    /* ─────────────────────────────────────────────
       SEND EMAILS
       (Should NOT normally be re-run)
    ───────────────────────────────────────────── */
    let sent = 0;
    let failed: { email: string; reason: string }[] = [];

    for (const user of users) {
      const { email, referral_code } = user;
      if (!email || !referral_code) continue;

      const referralLink = `https://sirensforge.vip/pricing?ref=${referral_code}`;

      try {
        await resend.emails.send({
          from: "Sirens Forge <noreply@sirensforge.vip>",
          to: email,
          subject: "Your Sirens Forge referral code — we’re almost there",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; line-height: 1.6;">
              <p>Hey,</p>

              <p>
                I wanted to personally reach out before we cross the finish line.
              </p>

              <p>
                Sirens Forge only exists because a small group of people believed
                this could be built the right way — especially after seeing what
                happens when trust is broken in this space.
              </p>

              <p>
                We all watched someone take money, promise a platform, and disappear.
                That didn’t just cost money — it destroyed trust. I refused to repeat that.
              </p>

              <p>
                That’s why I didn’t open early.<br/>
                That’s why I didn’t take money before things actually worked.<br/>
                And that’s why you’re hearing from me now.
              </p>

              <p>
                After covering infrastructure, servers, Stripe, email, and security —
                with Christmas days away and first-of-the-month bills coming up —
                we were tapped out right at the finish line.
              </p>

              <p>
                We’re extremely close now. What we needed was an influx of momentum
                and funding to push this across the finish line.
              </p>

              <hr />

              <p><strong>Your referral code:</strong></p>
              <p style="font-size:18px;font-weight:bold;">${referral_code}</p>

              <p><strong>Your referral link:</strong></p>
              <p><a href="${referralLink}">${referralLink}</a></p>

              <p>
                🧡<br/>
                Dustin & Allison
              </p>
            </div>
          `,
        });

        sent++;
      } catch (err: any) {
        console.error(`Email failed for ${email}`, err);
        failed.push({
          email,
          reason: err?.message || "Unknown error",
        });
      }
    }

    return NextResponse.json({
      success: true,
      total_users: users.length,
      emails_sent: sent,
      emails_failed: failed.length,
      failed,
    });
  } catch (err) {
    console.error("Unhandled error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
