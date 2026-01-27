import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Service-role client (required for signing URLs)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { lora_id, image_count } = await req.json();

    if (!lora_id || !image_count) {
      return NextResponse.json(
        { error: "Missing lora_id or image_count" },
        { status: 400 }
      );
    }

    if (image_count < 10 || image_count > 20) {
      return NextResponse.json(
        { error: "Image count must be between 10 and 20" },
        { status: 400 }
      );
    }

    const bucket = "lora-datasets";
    const basePath = `lora_datasets/${lora_id}`;

    const urls: {
      index: number;
      path: string;
      signedUrl: string;
    }[] = [];

    for (let i = 0; i < image_count; i++) {
      const path = `${basePath}/${Date.now()}_${i + 1}.jpg`;

      const { data, error } = await supabaseAdmin.storage
        .from(bucket)
        .createSignedUploadUrl(path);

      if (error || !data) {
        return NextResponse.json(
          { error: error?.message || "Failed to create signed URL" },
          { status: 500 }
        );
      }

      urls.push({
        index: i,
        path,
        signedUrl: data.signedUrl,
      });
    }

    return NextResponse.json({ urls });
  } catch (err: any) {
    console.error("[get-upload-urls] Fatal:", err);
    return NextResponse.json(
      { error: "Failed to generate upload URLs" },
      { status: 500 }
    );
  }
}
