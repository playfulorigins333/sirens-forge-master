type PendingSubmission = { fingerprint: string; key: string };

async function fingerprintIntent(intent: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(intent));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function pendingSubmissionKey(storageKey: string, intent: unknown) {
  const fingerprint = await fingerprintIntent(intent);
  try {
    const existing = JSON.parse(localStorage.getItem(storageKey) || "null") as PendingSubmission | null;
    if (existing?.fingerprint === fingerprint && typeof existing.key === "string") return existing.key;
  } catch { /* Replace malformed client-only state. */ }
  const key = crypto.randomUUID();
  localStorage.setItem(storageKey, JSON.stringify({ fingerprint, key } satisfies PendingSubmission));
  return key;
}

export function clearPendingSubmission(storageKey: string, key: string) {
  try {
    const existing = JSON.parse(localStorage.getItem(storageKey) || "null") as PendingSubmission | null;
    if (existing?.key === key) localStorage.removeItem(storageKey);
  } catch { localStorage.removeItem(storageKey); }
}
