import fs from "fs/promises";

export type IdentityLoraArtifactStat = {
  isFile(): boolean;
  isSymbolicLink(): boolean;
  size: number;
};

export type IdentityLoraLstat = (filePath: string) => Promise<IdentityLoraArtifactStat>;

/** A reusable identity-LoRA artifact must be a non-empty regular file, never a symlink. */
export async function isValidIdentityLoraArtifact(
  filePath: string,
  lstat: IdentityLoraLstat = fs.lstat,
): Promise<boolean> {
  try {
    const stat = await lstat(filePath);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0;
  } catch {
    return false;
  }
}
