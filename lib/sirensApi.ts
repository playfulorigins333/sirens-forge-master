export const SIRENS_API_INTERNAL_SECRET_MISSING =
  "SIRENS_API_INTERNAL_SECRET_MISSING";
export const SIRENS_API_BASE_URL_MISSING = "SIRENS_API_BASE_URL_MISSING";

export type SirensApiConfig = {
  baseUrl: string;
  internalSecret: string;
};

export function requireSirensApiConfig(): SirensApiConfig {
  const baseUrl = process.env.SIRENS_API_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error(SIRENS_API_BASE_URL_MISSING);

  const internalSecret = process.env.SIRENS_API_INTERNAL_SECRET?.trim();
  if (!internalSecret) throw new Error(SIRENS_API_INTERNAL_SECRET_MISSING);

  return { baseUrl, internalSecret };
}

export function sirensApiFetch(
  path: string,
  init: RequestInit = {},
  fetchImplementation: typeof fetch = fetch,
  config: SirensApiConfig = requireSirensApiConfig(),
) {
  const normalizedPath = `/${path.replace(/^\/+/, "")}`;
  const headers = new Headers(init.headers);
  headers.set("x-sirens-api-internal-secret", config.internalSecret);

  return fetchImplementation(`${config.baseUrl}${normalizedPath}`, {
    ...init,
    headers,
  });
}
