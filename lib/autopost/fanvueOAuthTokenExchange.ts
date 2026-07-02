export function buildFanvueTokenExchangeRequestInit(input: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
  codeVerifier: string
}) {
  return {
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    }),
  }
}
