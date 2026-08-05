import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { POST } from "../../../app/api/admin/send-affiliate-referral-emails/route";

const routePath = "app/api/admin/send-affiliate-referral-emails/route.ts";
const source = readFileSync(routePath, "utf8");

test("POST returns the locked deterministic 404 response", async () => {
  const response = await POST();
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Not found",
    code: "NOT_FOUND",
  });
});

test("route source contains no external side-effect implementation", () => {
  const prohibitedPatterns: Array<[RegExp, string]> = [
    [/\bResend\b/, "Resend client construction or import"],
    [/getSupabaseAdmin|createClient|supabaseAdmin|service_role/i, "Supabase administrator client construction or import"],
    [/\.emails\.send\b|\bsend\s*\(/, "email-send call"],
    [/\.from\(["']profiles["']\)|\bprofiles\b/, "profiles query"],
    [/\.update\s*\(/, "profile update"],
    [/referral_email_sent_at/, "referral_email_sent_at reference"],
    [/pricing\?ref=|\/pricing|referral link/i, "pricing referral-link generation"],
    [/referral_code|referralCode/i, "referral code read"],
    [/process\.env|authenticate|auth\.|cookies\(|headers\(|sleep|setTimeout|for\s*\(|for\s+\w+\s+of|while\s*\(/i, "conditional, authentication, delay, iteration, or environment-gated side effect"],
  ];

  for (const [pattern, description] of prohibitedPatterns) {
    assert.doesNotMatch(source, pattern, `route must not contain ${description}`);
  }
});

test("route source is limited to the locked response contract", () => {
  assert.match(source, /import \{ NextResponse \} from "next\/server";/);
  assert.match(source, /export async function POST\(\)/);
  assert.match(source, /status: 404/);
  assert.match(source, /error: "Not found"/);
  assert.match(source, /code: "NOT_FOUND"/);
  assert.doesNotMatch(source, /runtime|dynamic|try\s*\{|catch\s*\(/);
});
