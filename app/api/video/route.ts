import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "home";
export const maxDuration = 300;

const VIDEO_GENERATION_UNAVAILABLE_RESPONSE = {
  error: "VIDEO_GENERATION_UNAVAILABLE",
  message: "Video generation is currently unavailable.",
} as const;

export async function POST() {
  return NextResponse.json(VIDEO_GENERATION_UNAVAILABLE_RESPONSE, { status: 503 });
}
