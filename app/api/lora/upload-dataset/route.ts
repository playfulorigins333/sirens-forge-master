import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Service-role Supabase client (bypasses RLS by design)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const lora_id = form.get("lora_id") as string | null;
    if (!lora_id) {
      return NextResponse.json(
        { error: "Missing lora_id" },
        { status: 400 }
      );
    }

    const files = form.getAll("images").filter(
      (f): f is File => f instanceof File
    );

    if (files.length < 10 || files.length > 20) {
      return NextResponse.json(
        { error: "Image count must be between 10 and 20" },
        { status: 400 }
      );
    }

    const bucket = "lora-datasets";
    const basePath = `lora_datasets/${lora_id}`;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const buffer = Buffer.from(await file.arrayBuffer());

      const objectPath = `${basePath}/${Date.now()}_${i + 1}.jpg`;

      const { error } = await supabaseAdmin.storage
        .from(bucket)
        .upload(objectPath, buffer, {
          contentType: file.type || "image/jpeg",
          upsert: true,
        });

      if (error) {
        return NextResponse.json(
          { error: `Upload failed: ${error.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[upload-dataset] Fatal:", err);
    return NextResponse.json(
      { error: "Server upload failed" },
      { status: 500 }
    );
  }
}
