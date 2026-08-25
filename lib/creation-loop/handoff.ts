export const CREATION_LOOP_HANDOFF_STORAGE_KEY = "sirensforge:creation_loop_handoff";
export const CREATION_LOOP_HANDOFF_VERSION = 1 as const;

export type CreationLoopHandoff = {
  version: typeof CREATION_LOOP_HANDOFF_VERSION;
  source: "creation_loop";
  action: "reuse";
  prompt: string;
  negativePrompt?: string;
  baseModel?: "feminine" | "masculine";
  bodyMode?: string;
  mode?: string;
  identityId?: string;
  createdAt: number;
};

type ReusableCreation = {
  id: string;
  prompt?: string | null;
  negativePrompt?: string | null;
  baseModel?: string | null;
  bodyMode?: string | null;
  mode?: string | null;
  identityLora?: string | null;
  isIdentitySeed?: boolean;
  kind?: string;
};

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

export function buildCreationLoopHandoff(item: ReusableCreation): CreationLoopHandoff {
  const identitySeed = item.isIdentitySeed === true || item.kind === "identity";
  const identityId = isUuid(item.identityLora)
    ? item.identityLora.trim()
    : identitySeed && isUuid(item.id)
      ? item.id.trim()
      : undefined;
  const baseModel = item.baseModel === "feminine" || item.baseModel === "masculine"
    ? item.baseModel
    : item.bodyMode === "feminine" || item.bodyMode === "masculine"
      ? item.bodyMode
      : undefined;

  return {
    version: CREATION_LOOP_HANDOFF_VERSION,
    source: "creation_loop",
    action: "reuse",
    prompt: typeof item.prompt === "string" ? item.prompt.trim() : "",
    ...(typeof item.negativePrompt === "string" && item.negativePrompt.trim() ? { negativePrompt: item.negativePrompt.trim() } : {}),
    ...(baseModel ? { baseModel } : {}),
    ...(typeof item.bodyMode === "string" && item.bodyMode.trim() ? { bodyMode: item.bodyMode.trim() } : {}),
    ...(typeof item.mode === "string" && item.mode.trim() ? { mode: item.mode.trim() } : {}),
    ...(identityId ? { identityId } : {}),
    createdAt: Date.now(),
  };
}

export function parseCreationLoopHandoff(raw: string): CreationLoopHandoff | null {
  try {
    const value = JSON.parse(raw) as Partial<CreationLoopHandoff>;
    if (
      value.version !== CREATION_LOOP_HANDOFF_VERSION ||
      value.source !== "creation_loop" ||
      value.action !== "reuse" ||
      typeof value.prompt !== "string" ||
      typeof value.createdAt !== "number"
    ) return null;

    return {
      version: CREATION_LOOP_HANDOFF_VERSION,
      source: "creation_loop",
      action: "reuse",
      prompt: value.prompt.trim(),
      ...(typeof value.negativePrompt === "string" && value.negativePrompt.trim() ? { negativePrompt: value.negativePrompt.trim() } : {}),
      ...(value.baseModel === "feminine" || value.baseModel === "masculine" ? { baseModel: value.baseModel } : {}),
      ...(typeof value.bodyMode === "string" ? { bodyMode: value.bodyMode } : {}),
      ...(typeof value.mode === "string" ? { mode: value.mode } : {}),
      ...(isUuid(value.identityId) ? { identityId: value.identityId.trim() } : {}),
      createdAt: value.createdAt,
    };
  } catch {
    return null;
  }
}
