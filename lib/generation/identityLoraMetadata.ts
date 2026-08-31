import { createClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTITY_UNAVAILABLE = "IDENTITY_LORA_UNAVAILABLE";

export type OwnedIdentityLoraMetadata = {
  artifact_r2_bucket: string | null;
  artifact_r2_key: string;
  trigger_token: string;
};

export type DurableIdentityReference = {
  id: string;
  bucket: string;
  key: string;
  trigger_token: string;
};

export type IdentityLoraMetadataDependencies = {
  loadOwnedCompletedLora(loraId: string, userId: string): Promise<OwnedIdentityLoraMetadata | null>;
};

function serverDependencies(): IdentityLoraMetadataDependencies {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error(IDENTITY_UNAVAILABLE);

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return {
    async loadOwnedCompletedLora(loraId, userId) {
      const { data, error } = await supabase
        .from("user_loras")
        .select("artifact_r2_bucket,artifact_r2_key,trigger_token")
        .eq("id", loraId)
        .eq("user_id", userId)
        .eq("status", "completed")
        .maybeSingle();
      if (error || !data) return null;
      return data as OwnedIdentityLoraMetadata;
    },
  };
}

/** Resolves authoritative ownership and workflow metadata without reading artifact bytes. */
export async function resolveOwnedIdentityLoraMetadata(
  loraId: string,
  userId: string,
  deps?: IdentityLoraMetadataDependencies,
): Promise<OwnedIdentityLoraMetadata> {
  if (!UUID.test(loraId) || !UUID.test(userId)) throw new Error(IDENTITY_UNAVAILABLE);

  try {
    const metadata = await (deps ?? serverDependencies()).loadOwnedCompletedLora(loraId, userId);
    const artifactBucket = metadata?.artifact_r2_bucket?.trim() || null;
    const artifactKey = metadata?.artifact_r2_key?.trim();
    const triggerToken = metadata?.trigger_token?.trim();
    if (!metadata || !artifactKey || !triggerToken) throw new Error(IDENTITY_UNAVAILABLE);
    return { artifact_r2_bucket: artifactBucket, artifact_r2_key: artifactKey, trigger_token: triggerToken };
  } catch {
    throw new Error(IDENTITY_UNAVAILABLE);
  }
}

export async function buildDurableIdentityReference(
  loraId: string,
  userId: string,
  deps?: IdentityLoraMetadataDependencies,
): Promise<DurableIdentityReference> {
  const canonicalId = loraId.trim().toLowerCase();
  if (!UUID.test(canonicalId)) throw new Error(IDENTITY_UNAVAILABLE);
  const metadata = await resolveOwnedIdentityLoraMetadata(canonicalId, userId, deps);
  if (!metadata.artifact_r2_bucket) throw new Error(IDENTITY_UNAVAILABLE);
  return {
    id: canonicalId,
    bucket: metadata.artifact_r2_bucket,
    key: metadata.artifact_r2_key,
    trigger_token: metadata.trigger_token,
  };
}
