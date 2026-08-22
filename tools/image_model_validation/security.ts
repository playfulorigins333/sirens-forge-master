import path from "node:path";

const SECRET_PATTERN = /(api[_-]?key|access[_-]?token|service[_-]?role|presigned|credential|secret|x-amz-(credential|signature)|[?&](token|key|signature)=)/i;

export function assertNoSecret(value: string, label = "input"): void {
  if (SECRET_PATTERN.test(value)) throw new Error(`SENSITIVE_VALUE_REJECTED: ${label}`);
}

export function validateLocalPath(value: string): string {
  assertNoSecret(value, "path");
  if (!path.isAbsolute(value)) throw new Error("UNSAFE_PATH: an absolute local path is required");
  if (value.split(path.sep).includes("..")) throw new Error("UNSAFE_PATH: traversal is forbidden");
  return path.normalize(value);
}
