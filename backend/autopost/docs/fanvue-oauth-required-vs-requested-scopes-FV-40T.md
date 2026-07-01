# FV-40T Fanvue OAuth requested vs required connection scopes

FV-40T splits Fanvue OAuth scopes into two local source concepts:

1. **Approved/requestable scopes** — scopes the app is allowed to request in the OAuth authorize URL.
2. **Required connection scopes** — scopes that must be present in the OAuth token response scope set before the callback can continue toward identity verification and Connected OAuth storage.

## Approved/requestable scopes

`FANVUE_APPROVED_SCOPES` remains the allowlist for scopes that may be requested through `scope=` in the Fanvue OAuth authorize URL. It includes the refresh/offline-related scopes added in FV-40R:

- `openid`
- `offline_access`
- `offline`

It also preserves the current connection/media scopes:

- `read:self`
- `read:creator`
- `read:post`
- `write:post`
- `read:media`
- `write:media`

`write:creator` remains intentionally absent.

## Required connection scopes

`FANVUE_REQUIRED_CONNECTION_SCOPES` is intentionally smaller than the requestable allowlist. FV-40T requires only the launch-safe basic verified OAuth/media connection scopes:

- `read:self`
- `read:media`
- `write:media`

The callback uses this required set when deciding whether to return `fanvue_oauth_missing_required_scopes`.

## Refresh/offline scopes are requested, not fatal connection requirements

`openid`, `offline_access`, and `offline` continue to be requested for refresh-token issuance. FV-40T does not make them required to mark Connected OAuth because Fanvue may not echo or grant those scopes in `tokenResponse.scope` even when they were requested.

A callback response must not fail solely because `openid`, `offline_access`, or `offline` are absent from the returned scope string. It still fails if any required connection scope is absent.

## Upload readiness remains separate

FV-40T does not mark Fanvue upload-ready based on requested scopes. Upload readiness remains blocked until a later safe preflight confirms booleans such as:

- `encrypted_refresh_token_present`
- token freshness
- `scopes_include_read_media`
- `scopes_include_write_media`
- no blockers

## Safety boundary

FV-40T is a code/tests/docs gate only. It does not approve reconnect, OAuth-code use, live token exchange testing, provider identity calls, Fanvue API calls, media upload, `/posts`, dispatch wiring, public selectability, scheduling, Vercel env changes, local env changes, Supabase writes, SQL, or migrations.
