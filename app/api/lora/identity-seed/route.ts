import { NextResponse } from "next/server";
import { ensureActiveSubscription } from "@/lib/subscription-checker";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
const CONTROL = /[\u0000-\u001f\u007f]/;
const choices = {
  vibes: ["baddie", "goddess", "soft_girlfriend", "goth_alt", "dominant", "luxury", "gamer"],
  hair: ["blonde", "brunette", "black", "red", "fantasy"],
  style: ["lingerie", "streetwear", "luxury", "gym", "nude_nsfw"],
  energy: ["obsessed", "flirty", "cold", "possessive", "dominant"],
  intensity: ["soft", "bold", "extreme"],
} as const;
const safeString = (value: unknown, max: number, required = false) =>
  typeof value === "string" && value.trim().length <= max && (!required || value.trim()) && !CONTROL.test(value) ? value.trim() : null;

export async function POST(req: Request) {
  const auth = await ensureActiveSubscription();
  if (!auth.ok) return NextResponse.json({ error: auth.error, message: auth.message }, { status: auth.status });
  const body = await req.json().catch(() => null);
  if (!body || Object.keys(body).some((key) => !["identityName", "baseModel", "prompt", "negativePrompt", "selection", "selectedPreviewImage"].includes(key)))
    return NextResponse.json({ error: "INVALID_IDENTITY_SEED" }, { status: 400 });
  const name = safeString(body.identityName, 120, true);
  const prompt = safeString(body.prompt, 8000, true);
  const negative = safeString(body.negativePrompt, 4000, true);
  const preview = body.selectedPreviewImage == null ? null : safeString(body.selectedPreviewImage, 2048);
  const s = body.selection;
  const base = body.baseModel;
  const validSelection = s && typeof s === "object" && Object.keys(s).sort().join() === "baseModel,energy,hair,intensity,style,vibes" &&
    (base === "feminine" || base === "masculine") && s.baseModel === base && Array.isArray(s.vibes) && s.vibes.length >= 1 && s.vibes.length <= 2 &&
    new Set(s.vibes).size === s.vibes.length && s.vibes.every((v: string) => (choices.vibes as readonly string[]).includes(v)) &&
    (["hair", "style", "energy", "intensity"] as const).every((key) => typeof s[key] === "string" && (choices[key] as readonly string[]).includes(s[key]));
  if (!name || !prompt || !negative || preview === null && body.selectedPreviewImage != null || !validSelection)
    return NextResponse.json({ error: "INVALID_IDENTITY_SEED" }, { status: 400 });
  const { data, error } = await getSupabaseAdmin().from("user_loras").insert({
    user_id: auth.user.id, status: "draft", name,
    description: "Created from Build My Model on the Generate page.", preview_url: preview,
    source: "build_my_model", base_model: base, prompt, negative_prompt: negative,
    selection: s, is_identity_seed: true, image_count: preview ? 1 : 0,
  }).select("id,status").single();
  if (error || !data) return NextResponse.json({ error: "IDENTITY_SEED_CREATE_FAILED" }, { status: 500 });
  return NextResponse.json({ lora_id: data.id, status: data.status }, { status: 201 });
}
