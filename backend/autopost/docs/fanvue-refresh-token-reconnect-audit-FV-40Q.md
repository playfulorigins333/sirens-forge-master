# FV-40Q Fanvue refresh-token missing audit and reconnect strategy

Date: 2026-07-01

## Scope and safety

This is a docs-only audit. No live Fanvue API, token, identity, upload, signed URL, completion, media readback, post, OAuth reconnect, Supabase write, SQL write, migration, Vercel env, or local env change is part of this gate.

## UI connected-state meaning

The Autopost client treats Fanvue as connected only when `/api/autopost/platforms/me` returns `user_connected === true` and `connection_status === "CONNECTED"`. The status route selects the account row fields needed for connection validation, including encrypted access/refresh token columns and metadata, then delegates status shaping to `buildUserPlatformStatus`.

For Fanvue, `buildUserPlatformStatus` computes `user_connected` from `getFanvueConnectionBlocker`. That blocker requires configured OAuth, an account row, `connection_status === "CONNECTED"`, a non-empty `provider_account_id`, a non-empty `encrypted_access_token`, `metadata.provider === "fanvue"`, and `metadata.identity_fetched === true`.

The UI does not use refresh-token presence, token expiry, or upload readiness for the "Connected OAuth" badge. It also does not expose token freshness, refresh-token presence, or native upload readiness as separate Fanvue states. Native posting remains hard-coded unavailable with `native_posting_available: false`, `supports_media_posting: false`, `public_selectable: false`, and `can_schedule: false`.

Therefore, a row can correctly show "Connected OAuth" for identity/internal validation while the upload-only runner blocks with `FANVUE_REFRESH_TOKEN_MISSING` when the access token is stale or near-expired and `encrypted_refresh_token` is absent.

## OAuth authorize URL construction

The Fanvue start route creates a signed OAuth state and redirects to `buildFanvueAuthorizeUrl`. The authorize URL currently sets exactly these query parameters:

- `response_type=code`
- `client_id=<configured client id>`
- `redirect_uri=<configured redirect URI>`
- `scope=<configured approved scopes joined by spaces>`
- `state=<random OAuth state>`
- `code_challenge=<PKCE challenge>`
- `code_challenge_method=S256`

The current authorize URL does not set `access_type=offline`, `prompt=consent`, `offline_access`, `offline`, or any Fanvue-specific refresh-token parameter outside the `scope` value.

Public Fanvue OAuth docs found during this audit state that default scopes should include `openid`, `offline_access`, and `offline`, and that `offline_access` provides refresh tokens. Those scopes are not currently in the repo-approved Fanvue scope allowlist, so they should not be added without a dedicated URL/scope fix gate and tests.

## Scope findings

The repo-approved/default Fanvue scopes are exactly:

- `read:self`
- `read:creator`
- `read:post`
- `write:post`
- `read:media`
- `write:media`

Preserved facts:

- `read:media` is present.
- `write:media` is present.
- `write:creator` is absent.

Offline/refresh-related scopes currently absent from the repo allowlist/defaults:

- `offline_access`
- `offline`
- `openid`

Because `getFanvueRequestedScopes` rejects any scope outside `FANVUE_APPROVED_SCOPES`, setting these scopes in env today would fail with `FANVUE_OAUTH_SCOPES_UNAPPROVED` until the allowlist is intentionally updated.

## Callback token parsing and storage

The callback's token response type makes `refresh_token` optional. On successful code exchange and identity verification, the callback encrypts and stores `access_token`. It encrypts and stores `refresh_token` only when the token response includes a truthy refresh token; otherwise it stores `encrypted_refresh_token: null` through the upsert. It computes `token_expires_at` from `expires_in` when present and stores null when absent.

Existing source-safety tests assert encrypted refresh-token storage is wired and plaintext token fields are not written. Existing refresh-helper tests prove a returned refresh token is encrypted and persisted during refresh, a missing refresh token during refresh preserves the existing encrypted refresh token, and a missing stored refresh token blocks safely without provider calls. The tests do not currently prove the callback path's absent-`refresh_token` upsert behavior with a route-level mocked callback test.

## Reconnect strategy recommendation

Safest strategy:

1. Do not run live upload, provider calls, token refresh, identity verification, or OAuth reconnect in FV-40Q.
2. Add a small FV-40R fix only if accepted: update the Fanvue OAuth scope allowlist/defaults to include official refresh-token scopes (`offline_access` and, if required by official docs/app settings, `offline` and `openid`) with tests proving `write:creator` remains absent and no prompt/access-type parameter is invented.
3. After any scope fix is deployed with gates still off, have a human/admin manually reconnect Fanvue through the existing UI. Reconnect should use the existing callback upsert on `user_id,platform`, replacing the account row token material when the provider returns a refresh token.
4. Do not add `prompt=consent`, `access_type=offline`, or another parameter unless official Fanvue docs prove it is required. Current public docs found in this audit point to scopes rather than those query parameters.
5. Retry any upload-only live attempt only after reconnect and a safe status/preflight confirms refresh-token presence and token freshness without printing token values.
6. If Fanvue does not issue refresh tokens for the approved/app scopes, the upload-only runner should remain blocked once the access token is stale; any later upload-only test would require a recent fresh access token and explicit human approval, with no assumption that long-running refresh is available.

## Safe post-reconnect preflight recommendation

A safe post-reconnect preflight should report booleans/classifications only and must never print token values, encrypted token values, codes, secrets, signed URLs, or raw provider responses. Recommended fields:

- `platform: "fanvue"`
- `connection_status`
- `provider_account_id_present: true/false`
- `provider_username_present: true/false`
- `encrypted_access_token_present: true/false`
- `encrypted_refresh_token_present: true/false`
- `token_expires_at_present: true/false`
- `token_freshness: "fresh" | "near_expiry" | "expired" | "missing" | "invalid"`
- `metadata_provider_is_fanvue: true/false`
- `metadata_identity_fetched: true/false`
- `scopes_include_read_media: true/false`
- `scopes_include_write_media: true/false`
- `scopes_include_write_creator: true/false`
- `scopes_include_offline_access: true/false`
- `scopes_include_offline: true/false`
- `native_upload_readiness: "blocked" | "ready_for_upload_only_gate"`
- `blockers: string[]`

The preflight may read the account row and env-derived config, but should perform no SQL writes, no Supabase writes, no provider calls, no token refresh, no identity verification, and no reconnect.

## Recommended next gate

Recommended next smallest gate: FV-40R OAuth authorize scope/allowlist fix with mocked/source tests, because official public Fanvue docs indicate `offline_access` is needed to receive refresh tokens and the current repo allowlist prevents requesting it. Keep `write:creator` absent and keep all live/upload/dispatch/public-select/scheduling gates disabled. After that, run a separate manual reconnect runbook and then a safe post-reconnect DB/status preflight before any FV-40S live upload-only retry.
