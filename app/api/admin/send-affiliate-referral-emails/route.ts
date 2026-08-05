import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Not found", code: "NOT_FOUND" },
    { status: 404 }
  );
}
