export function safeInternalNext(value: unknown, fallback = "/dashboard") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback
  try {
    const parsed = new URL(value, "https://sirensforge.invalid")
    return parsed.origin === "https://sirensforge.invalid" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback
  } catch { return fallback }
}

export function policyConsentPath(next: string) {
  return `/account/policy-consent?next=${encodeURIComponent(safeInternalNext(next))}`
}
