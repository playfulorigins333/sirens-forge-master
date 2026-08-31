import { UUID_RE } from "./contract";
export const canonicalProjectId = (value: unknown): string | null => { if (typeof value !== "string") return null; const id = value.trim().toLowerCase(); return UUID_RE.test(id) ? id : null; };
export const restoreVideoProjectIds = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.map(canonicalProjectId).filter((id): id is string => id !== null))] : [];
export const shouldUploadVideoSource = (imageFile: File | null, sourceGenerationAssetId: string | null) => Boolean(imageFile && !sourceGenerationAssetId);
export const shouldRetainVideoProject = (status: number) => status === 409 || status >= 500;
export type PendingVideoSourceUpload = { fileKey: string; uploadId: string; putComplete: true };
export const videoSourceFileKey = (file: Pick<File,"name"|"size"|"type"|"lastModified">) => `${file.name}\u0000${file.size}\u0000${file.type}\u0000${file.lastModified}`;
export const reusablePendingVideoSource = (pending: PendingVideoSourceUpload | null, file: Pick<File,"name"|"size"|"type"|"lastModified">): PendingVideoSourceUpload | null => pending?.fileKey === videoSourceFileKey(file) ? pending : null;
export const shouldClearPendingVideoSource = (status: number) => status === 400 || status === 404;
