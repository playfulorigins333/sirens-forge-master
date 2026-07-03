import { applyFanvueOAuthClientAuth } from "./fanvueOAuthClientAuth"

export function buildFanvueTokenExchangeRequestInit(input: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
  codeVerifier: string
}) {
  const headers = {
    "content-type": "application/x-www-form-urlencoded",
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  })
  applyFanvueOAuthClientAuth({
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    headers,
    body,
  })
  return { headers, body }
}
