# FV-40S Fanvue manual reconnect runbook

Date: 2026-07-01

## 1. Purpose

FV-40S is a docs-only manual procedure for safely reconnecting Fanvue OAuth in production after FV-40R added the refresh/offline scopes that a future OAuth authorization can request:

- `openid`
- `offline_access`
- `offline`

FV-40S exists because FV-40P safely blocked before any provider calls with `FANVUE_REFRESH_TOKEN_MISSING`, and FV-40R only updated the approved/default Fanvue OAuth scope allowlist. A human/admin still needs to perform a production OAuth reconnect so the callback can request the new refresh/offline scopes and store any refresh-token material returned by Fanvue.

This runbook does **not** approve live upload. It does **not** approve posting. It does **not** approve dispatch wiring. It does **not** approve making Fanvue public-selectable or schedulable.

## 2. Before reconnect checklist

Before starting the manual reconnect, confirm every item below:

- [ ] PR #39 / FV-40R is merged to `main`.
- [ ] The production deployment that includes FV-40R is green.
- [ ] Vercel safety envs remain off or blank:
  - [ ] `FANVUE_ADMIN_LIVE_PHOTO_UPLOAD_ENABLED`
  - [ ] `FANVUE_RUN_DISPATCH_ENABLED`
  - [ ] `FANVUE_POST_VERIFY_ENABLED`
- [ ] Do **not** change Vercel envs.
- [ ] Do **not** run FV-40P again.
- [ ] Do **not** run any upload command.
- [ ] Use the production site only for the OAuth reconnect.
- [ ] Be logged into the correct admin/internal Sirens Forge account.
- [ ] If Fanvue prompts for login, be logged into the correct Fanvue account.
- [ ] Do **not** paste OAuth codes, access tokens, refresh tokens, encrypted tokens, client secrets, Supabase keys, signed URLs, or raw provider responses anywhere.

## 3. Exact manual reconnect steps

Perform these steps slowly and stop after connection status returns to Sirens Forge:

1. Open `https://sirensforge.vip/autopost` in a normal browser session controlled by the human/admin.
2. Confirm the Autopost page loads as the correct admin/internal Sirens Forge user.
3. Look for the Fanvue connection area. Current app posture may expose connection controls near an Autopost, connection, account, settings, or platform-management area rather than inside the public platform list.
4. Look for likely labels such as:
   - `Connect Fanvue`
   - `Reconnect Fanvue`
   - `Connected OAuth`
   - `Manage connection`
   - `Platforms`
5. If a Fanvue connect/reconnect control is visible, click it once.
6. If Fanvue opens a consent/authorization screen, review the request and approve/authorize the requested scopes only if the account is the correct Fanvue account.
7. Confirm the browser redirects back to Sirens Forge.
8. Confirm the returned Sirens Forge URL/status indicates a safe connection outcome, such as `connected=fanvue`, Fanvue connected status, or the `Connected OAuth` badge.
9. Stop there. Do not run upload, publish, post, schedule, dispatch, or verification actions.

If the exact Fanvue button is not visible, do **not** invent a route, craft an OAuth URL, or manually call any endpoint from Codex. Capture/report only safe UI context: which page was open, which tab/section was selected, and whether labels such as `Connect Fanvue`, `Reconnect Fanvue`, `Connected OAuth`, `Manage connection`, or `Platforms` were visible. Do not include OAuth codes, tokens, secrets, signed URLs, or raw provider responses in screenshots or reports.

## 4. What not to do during reconnect

During this reconnect procedure:

- Do **not** run live upload.
- Do **not** enable Vercel flags.
- Do **not** change `.env.local`.
- Do **not** paste an OAuth code.
- Do **not** paste access tokens, refresh tokens, encrypted tokens, client secrets, Supabase keys, signed URLs, or raw provider responses.
- Do **not** inspect browser network token payloads.
- Do **not** change Supabase data or schema.
- Do **not** click anything that says post, publish, schedule, dispatch, approve, or run.
- Do **not** make Fanvue selectable or schedulable.
- Do **not** run SQL.

## 5. Expected result after reconnect

The safe expected result is limited:

- The UI may still show `Connected OAuth`.
- Native media upload may still show disabled.
- Native posting may still show disabled.
- Scheduling may still show disabled.
- That is okay and expected.
- The next gate must be a safe post-reconnect preflight that reports only booleans and classifications.

A successful manual reconnect does not by itself prove that Fanvue returned a refresh token. It only gives the deployed callback an opportunity to request the FV-40R refresh/offline scopes and store whatever token material Fanvue returns.

## 6. Reconnect failure handling

### Fanvue does not show a consent/approval screen

- Stop after returning to Sirens Forge.
- Do not force consent by adding unapproved query parameters.
- Do not hand-build an authorize URL.
- Report that no Fanvue consent screen was shown and include the safe final Sirens Forge status label, if present.

### Fanvue returns an error

- Stop immediately after redirect.
- Do not retry repeatedly.
- Report only the safe error label/status shown by Sirens Forge or Fanvue.
- Do not paste raw provider responses, OAuth codes, tokens, or full callback URLs.

### Redirect fails

- Stop and record the safe browser-visible symptom, such as redirect timeout, invalid redirect, or app error page.
- Do not manually replay callback URLs.
- Do not paste the full redirect URL if it contains `code`, `state`, tokens, or other sensitive query values.

### App still shows disconnected

- Stop.
- Report the safe UI status: disconnected, OAuth not configured, connect disabled, or the displayed app error label.
- Do not edit database rows, environment variables, or Supabase data to force a connected state.

### App still shows connected but later preflight shows refresh token missing

- Treat upload as still blocked.
- Do not retry FV-40P or any live upload command.
- Report the boolean/classification result from the preflight only, such as `encrypted_refresh_token_present: false` and blocker `FANVUE_REFRESH_TOKEN_MISSING`.
- Plan a separate investigation gate; do not assume posting is safe.

### User accidentally lands on a URL with an OAuth code

- Do not paste the full URL publicly.
- Do not paste the `code` value.
- Do not paste `state` or other sensitive query values.
- If reporting is needed, include only the safe error label/status if present and say that a callback URL contained an OAuth code that was not shared.

## 7. Safe post-reconnect preflight handoff

The next gate after manual reconnect is **not upload**.

Recommended next gate:

`FV-40T — safe post-reconnect token posture preflight, booleans only`

FV-40T should report only safe booleans and classifications:

- `connection_status`
- `provider_account_id_present`
- `provider_username_present`
- `encrypted_access_token_present`
- `encrypted_refresh_token_present`
- `token_expires_at_present`
- `token_freshness`
- `scopes_include_read_media`
- `scopes_include_write_media`
- `scopes_include_write_creator`
- `scopes_include_openid`
- `scopes_include_offline_access`
- `scopes_include_offline`
- `native_upload_readiness`
- `blockers`

FV-40T must not print:

- access token
- refresh token
- encrypted token
- OAuth code
- Supabase key
- signed URL
- raw provider response
- secrets

FV-40T must not perform provider calls, token refresh, identity verification, upload session creation, signed URL calls, completion calls, media readback, `/posts` calls, Supabase writes, SQL writes, migrations, Vercel env changes, or OAuth reconnect.

## 8. Safe status

- Fanvue native upload remains blocked until post-reconnect preflight passes.
- No live upload is approved by FV-40S.
- No post creation is approved by FV-40S.
- No `/posts` call is approved by FV-40S.
- No dispatch wiring is approved by FV-40S.
- No public selectability is approved by FV-40S.
- No scheduling is approved by FV-40S.
- Next action is manual reconnect only after human confirmation, then FV-40T preflight.

## FV-40CY admin-only write:creator reconnect hardening note

FV-40CY adds code-level hardening for future admin-only `write:creator` reconnect initiation, but it does not approve reconnect yet. It does not approve upload, post, dispatch, or scheduling. It does not prove `creatorUserUuid`; `top_level_uuid` remains candidate-only. Refresh-only diagnostic must not be the first verification after reconnect.
