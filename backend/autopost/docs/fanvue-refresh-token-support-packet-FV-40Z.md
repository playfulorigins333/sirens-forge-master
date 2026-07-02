# Fanvue Refresh Token Support Packet — FV-40Z

## Purpose

Sirens Forge is integrating Fanvue connected-user media upload and needs durable token renewal before Fanvue native upload can be considered launch-ready.

This packet is about connected-user upload-only readiness for Fanvue media upload. It is not approval to create posts, call `/posts`, enable dispatch, enable scheduling, or make Fanvue public-selectable.

This packet is safe to share with Fanvue support or keep internally. It intentionally excludes secrets, tokens, OAuth codes, signed URLs, Supabase keys, environment values, raw provider responses, and private credentials.

## Current safe state

- Fanvue OAuth connection can complete.
- A stored access token can be fresh immediately after reconnect.
- `read:media` is present.
- `write:media` is present.
- `write:creator` is absent.
- `write:creator` is not required for connected-user upload-only readiness in this work.
- `encrypted_refresh_token` is missing.
- After time passed, `token_freshness` became `expired`.
- Native upload readiness remains blocked.
- No live upload should be attempted while the access token is expired and the refresh token is missing.

## Current OAuth request model

From the current Sirens Forge code, `FANVUE_APPROVED_SCOPES` includes:

- `openid`
- `offline_access`
- `offline`
- `read:self`
- `read:creator`
- `read:post`
- `write:post`
- `read:media`
- `write:media`

`write:creator` is absent.

`FANVUE_REQUIRED_CONNECTION_SCOPES` includes:

- `read:self`
- `read:media`
- `write:media`

`openid`, `offline_access`, and `offline` are requestable for refresh-token support, but they are not required for connection completion because Fanvue may not echo or grant every requested optional scope in the token response scope string.

The authorize URL sends requested scopes through the standard `scope` parameter.

The authorize URL currently does not send:

- `prompt=consent`
- `access_type=offline`
- `approval_prompt=force`
- any known Fanvue-specific refresh-token parameter

Sirens Forge should not add one of those parameters unless Fanvue support or official Fanvue documentation confirms the parameter is required and supported.

## Current callback behavior

The callback token response type allows an optional `refresh_token`.

If `tokenResponse.refresh_token` is returned, Sirens Forge encrypts and stores it in `encrypted_refresh_token`.

If no `refresh_token` is returned, Sirens Forge stores `encrypted_refresh_token` as `null`.

No code evidence was found that the callback accidentally discards a returned `refresh_token`. From local code inspection, the likely issue is that no `refresh_token` is being returned for the reconnect state that was observed.

## Current refresh helper behavior

The refresh helper requires a stored encrypted refresh token before attempting provider refresh.

If the encrypted refresh token is missing, the refresh helper returns `FANVUE_REFRESH_TOKEN_MISSING` and `provider_calls_attempted` remains `false`.

When a refresh response includes a replacement `refresh_token`, the helper encrypts it.

When a refresh response omits a new `refresh_token`, the helper preserves the existing encrypted refresh token.

## Current upload-only behavior

The upload-only admin script can proceed with `upload_photo_only` when the stored access token is fresh, even if `encrypted_refresh_token` is missing.

`encrypted_refresh_token` is not an unconditional runtime blocker for the upload-only admin script.

`encrypted_refresh_token` is required when the access token is stale, missing, invalid, expired, or near expiry and refresh is needed before Fanvue upload calls.

In the current expired-token/no-refresh-token state, upload blocks safely with `FANVUE_REFRESH_TOKEN_MISSING` before provider upload calls. It blocks before access-token decrypt, upload session creation, signed URL request, byte upload, upload completion, media readback, `/posts`, and dispatch.

## Questions for Fanvue support

1. Can this Fanvue app/integration receive refresh tokens?
2. Are refresh tokens supported for connected-user OAuth media upload?
3. Is `offline_access` sufficient to receive a refresh token?
4. Is `offline` required to receive a refresh token?
5. Is `openid` required to receive a refresh token?
6. Are refresh tokens issued only on first consent?
7. Does Fanvue require `prompt=consent` or another consent parameter?
8. Does Fanvue support `access_type=offline`, or is that parameter not applicable to Fanvue OAuth?
9. Does Fanvue require app-level enablement or support approval before refresh tokens are issued?
10. Are refresh tokens unavailable for this app/scope combination?
11. Are refresh tokens unavailable for connected-user media upload?
12. Should this integration be treated as short-lived access-token-only?
13. Is there a Fanvue-specific OAuth parameter or dashboard setting required for refresh tokens?
14. Does Fanvue ever omit `refresh_token` while still returning short-lived access tokens for `offline_access`/`offline` requests?
15. What is the expected token lifetime and renewal model for `POST /media/uploads`?

## Safe support message draft

Hello Fanvue Support,

Sirens Forge is integrating connected-user Fanvue media upload. We are trying to confirm the correct OAuth setup for durable token renewal before enabling native upload readiness.

Our integration requests `read:media` and `write:media` for connected-user media upload. We also request `openid`, `offline_access`, and `offline` to support durable token renewal. `write:creator` is absent and is not required for our connected-user upload-only readiness path.

OAuth connection completes successfully, and we receive and store an access token. Our callback is prepared to encrypt and store `refresh_token` if Fanvue returns one. However, no `refresh_token` appears to be returned/stored for the reconnect state we observed.

After the access token expires, our upload-only admin path correctly blocks before provider calls because no refresh token exists. The safe internal error is `FANVUE_REFRESH_TOKEN_MISSING`; no upload, post creation, `/posts` call, or dispatch happens.

Could you please confirm what is required for Fanvue refresh-token issuance for this app/integration?

Specifically:

- Can this app receive refresh tokens?
- Are refresh tokens supported for connected-user OAuth media upload?
- Is `offline_access` sufficient, or are `offline` and/or `openid` also required?
- Is a consent parameter such as `prompt=consent` required or supported?
- Is `access_type=offline` supported or not applicable?
- Is app-level/dashboard/support enablement required?
- Are refresh tokens issued only on first consent or under specific re-consent conditions?
- Should this integration be treated as short-lived access-token-only if no refresh token is issued?
- What token lifetime and renewal model should be used for `POST /media/uploads`?

We are not asking for secrets or account-specific token values. We only need the supported OAuth requirements and expected refresh-token behavior.

Thank you.

## Launch safety conclusion

Fanvue native upload remains not launch-ready.

Fanvue native upload remains disabled for public selectability, scheduling, and dispatch.

No `/posts` integration should be enabled.

No native launch readiness should be claimed until durable token renewal is confirmed and tested.

`write:creator` absence is not the blocker.

The blocker is refresh-token durability.

## Next recommended gate

**FV-40AA — Fanvue support response review**

Purpose:

Review Fanvue's answer and decide whether to:

- add a supported OAuth parameter,
- update app settings,
- request provider enablement,
- keep Fanvue disabled,
- or document a short-lived reconnect-only strategy.

Do not proceed to a code gate unless the support response or official Fanvue evidence supports a specific change.
