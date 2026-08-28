import { UUID_RE } from "../private-creator-media/core";

export type CreatorImageResult = {
  generation_id: string;
  prompt: string;
  negative_prompt: string;
  body_mode: string;
  steps: number;
  cfg: number;
  seed: number;
  width: number;
  height: number;
  completed_at: string;
  identity_id: string | null;
  outputs: Array<{ id: string; generation_id: string; kind: "image"; ordinal: number; private_asset: true }>;
};

export async function loadCreatorImageResult(admin: any, ownerId: string, reference: any): Promise<CreatorImageResult | null> {
  const generationId = reference?.generation_id;
  const assetIds = reference?.asset_ids;
  if (!UUID_RE.test(generationId ?? "") || !Array.isArray(assetIds) || assetIds.length < 1 || assetIds.length > 4 ||
      new Set(assetIds).size !== assetIds.length || assetIds.some((id: unknown) => typeof id !== "string" || !UUID_RE.test(id))) return null;

  const { data: generation, error: generationError } = await admin.from("generations")
    .select("id,user_id,prompt,negative_prompt,body_type,steps,cfg_scale,seed,width,height,completed_at,lora_used,status,job_type")
    .eq("id", generationId).eq("user_id", ownerId).eq("status", "completed").eq("job_type", "image").maybeSingle();
  if (generationError || !generation) return null;

  const { data: assets, error: assetError } = await admin.from("generation_assets")
    .select("id,generation_id,owner_id,ordinal,kind").eq("generation_id", generationId).eq("owner_id", ownerId).eq("kind", "image").order("ordinal");
  if (assetError || !Array.isArray(assets) || assets.length !== assetIds.length) return null;
  const actualIds = new Set(assets.map((asset: any) => asset.id));
  if (assetIds.some((id: string) => !actualIds.has(id)) || assets.some((asset: any, ordinal: number) => asset.ordinal !== ordinal)) return null;

  return {
    generation_id: generation.id,
    prompt: generation.prompt ?? "",
    negative_prompt: generation.negative_prompt ?? "",
    body_mode: generation.body_type ?? "none",
    steps: Number(generation.steps), cfg: Number(generation.cfg_scale), seed: Number(generation.seed),
    width: Number(generation.width), height: Number(generation.height), completed_at: generation.completed_at,
    identity_id: UUID_RE.test(generation.lora_used ?? "") ? generation.lora_used : null,
    outputs: assets.map((asset: any) => ({ id: asset.id, generation_id: generation.id, kind: "image" as const, ordinal: asset.ordinal, private_asset: true as const })),
  };
}
