export type FanvueOAuthClientAuthMethod = "body" | "basic"

export type FanvueOAuthClientAuthInput = {
  clientId: string
  clientSecret: string
  headers: Record<string, string>
  body: URLSearchParams
}

export function getFanvueOAuthClientAuthMethod(): FanvueOAuthClientAuthMethod {
  const configured = process.env.FANVUE_OAUTH_CLIENT_AUTH_METHOD?.trim() ?? ""
  if (!configured) return "body"
  if (configured === "body" || configured === "basic") return configured
  throw new Error("FANVUE_OAUTH_CLIENT_AUTH_METHOD_INVALID")
}

export function applyFanvueOAuthClientAuth(input: FanvueOAuthClientAuthInput) {
  const method = getFanvueOAuthClientAuthMethod()
  if (method === "body") {
    input.body.set("client_id", input.clientId)
    input.body.set("client_secret", input.clientSecret)
    return { method, headers: input.headers, body: input.body }
  }

  input.headers.authorization = `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`, "utf8").toString("base64")}`
  input.body.delete("client_id")
  input.body.delete("client_secret")
  return { method, headers: input.headers, body: input.body }
}
