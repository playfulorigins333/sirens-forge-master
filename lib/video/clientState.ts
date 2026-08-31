import { UUID_RE } from "./contract";
export const canonicalProjectId = (value: unknown): string | null => { if (typeof value !== "string") return null; const id = value.trim().toLowerCase(); return UUID_RE.test(id) ? id : null; };
export const restoreVideoProjectIds = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.map(canonicalProjectId).filter((id): id is string => id !== null))] : [];
export const shouldUploadVideoSource = (imageFile: File | null, sourceGenerationAssetId: string | null) => Boolean(imageFile && !sourceGenerationAssetId);
export const shouldRetainVideoProject = (status: number) => status === 409 || status >= 500;
