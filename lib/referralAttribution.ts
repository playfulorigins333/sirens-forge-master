export const REFERRAL_STORAGE_KEY = "sf_referral_code";
export const REFERRAL_CAPTURED_AT_KEY = "sf_referral_code_captured_at";
export const REFERRAL_WINDOW_MS = 60 * 24 * 60 * 60 * 1_000;

type ReferralStorage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

export function normalizeReferralCode(value: string): string | null {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9_-]{4,20}$/.test(normalized) ? normalized : null;
}

export function clearStoredReferral(storage: ReferralStorage) {
  storage.removeItem(REFERRAL_STORAGE_KEY);
  storage.removeItem(REFERRAL_CAPTURED_AT_KEY);
}

export function captureReferral(storage: ReferralStorage, value: string, nowMs: number): string | null {
  const code = normalizeReferralCode(value);
  if (!code || !Number.isFinite(nowMs) || nowMs < 0) return null;
  storage.setItem(REFERRAL_STORAGE_KEY, code);
  storage.setItem(REFERRAL_CAPTURED_AT_KEY, String(nowMs));
  return code;
}

export function readCurrentReferral(storage: ReferralStorage, nowMs: number): string | null {
  const raw = storage.getItem(REFERRAL_STORAGE_KEY) || "";
  const code = normalizeReferralCode(raw);
  const capturedAt = Number(storage.getItem(REFERRAL_CAPTURED_AT_KEY));
  if (!code || !Number.isFinite(capturedAt) || capturedAt < 0 || nowMs < capturedAt || nowMs - capturedAt >= REFERRAL_WINDOW_MS) {
    clearStoredReferral(storage);
    return null;
  }
  return code;
}
