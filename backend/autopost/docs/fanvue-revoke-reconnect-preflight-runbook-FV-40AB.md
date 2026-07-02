# Fanvue Revoke + Reconnect Preflight Runbook — FV-40AB

## Purpose

This runbook is only for a human operator to test whether revoking old Fanvue consent and reconnecting through the Sirens Forge production OAuth flow causes Fanvue to grant the system/default OAuth scopes `openid`, `offline_access`, and `offline`, and to return/store a durable refresh token.

This runbook is **not** approval to upload media, create posts, dispatch posts, schedule Fanvue posts, verify posts, or make Fanvue public-selectable.

## Why this is needed

- Fanvue Builder resource scopes look correct for the current upload-only readiness investigation.
- `read:self`, `read:media`, and `write:media` are configured.
- `write:creator` is absent and is not the blocker for connected-user upload-only readiness in this work.
- Fanvue official docs say `offline_access` provides refresh tokens.
- Fanvue official docs say access tokens are short-lived, typically 1 hour, and refresh tokens rotate and are single-use.
- Stored token state after the prior reconnect did not include `encrypted_refresh_token`, `openid`, `offline_access`, or `offline`.
- The most likely remaining cause is old OAuth grant reuse or no fresh consent for the system/default offline scopes.
- A user-side revoke/disconnect followed by a production reconnect is the safest official way to force fresh consent before another safe preflight.

## Preconditions

Before starting, confirm all of the following:

- GitHub `main` is clean and current.
- The production deployment is green.
- There are no code changes pending.
- The Fanvue support message has already been sent, or the FV-40Z support packet exists at `backend/autopost/docs/fanvue-refresh-token-support-packet-FV-40Z.md`.
- Fanvue Builder resource scopes have been confirmed exactly as:

  ```text
  read:self read:creator read:post read:media write:post write:media
  ```

- No upload gate is approved.
- No dispatch gate is approved.
- No post verification gate is approved.

## Safety rules

- Do not run upload.
- Do not run FV-40P.
- Do not run FV-40X upload.
- Do not call `/posts`.
- Do not create posts.
- Do not enable dispatch.
- Do not enable public selectability.
- Do not enable scheduling.
- Do not paste secrets.
- Do not paste `.env.local`.
- Do not paste Supabase keys.
- Do not paste Fanvue tokens.
- Do not paste OAuth codes.
- Do not paste signed URLs.
- Do not paste raw provider responses.

## Human Step A — local repo sync/check

Run these exact PowerShell commands from the local repository:

```powershell
git checkout main
git pull origin main
git status --short
git log -1 --oneline
```

Expected:

- `git status --short` should be blank.
- `git log -1 --oneline` should show the latest `main` commit, which must be FV-40Z or newer.

Stop if the repository is not clean or is not current.

## Human Step B — confirm process env safety flags are blank

Run these exact PowerShell commands before starting the live browser steps:

```powershell
[Environment]::GetEnvironmentVariable("FANVUE_ADMIN_LIVE_PHOTO_UPLOAD_ENABLED", "Process")
[Environment]::GetEnvironmentVariable("FANVUE_RUN_DISPATCH_ENABLED", "Process")
[Environment]::GetEnvironmentVariable("FANVUE_POST_VERIFY_ENABLED", "Process")
[Environment]::GetEnvironmentVariable("DOTENV_CONFIG_PATH", "Process")
```

Expected:

- All commands should print blank output before starting.

Stop if any upload, dispatch, post verification, or dotenv process variable is already set.

## Human Step C — revoke/disconnect old Fanvue grant

Use the Fanvue user-side third-party apps settings path:

```text
https://fanvue.com/settings/account/third-party-apps
```

Steps:

1. Log into Fanvue as the connected creator account.
2. Open **Settings → Account → Third Party Apps / Third Party Apps Consent**.
3. Find **Sirens Forge Autopost Internal Test** / the Sirens Forge app.
4. Revoke or disconnect access.
5. Do **not** delete the Builder app.
6. Do **not** regenerate the client secret.
7. Do **not** change app permissions.
8. Do **not** change the redirect URI.
9. Do **not** change the app ID/client ID.

## Human Step D — production OAuth reconnect

Open this production OAuth start route in the browser:

```text
https://sirensforge.vip/api/autopost/connect/fanvue/start
```

Expected:

- The browser should return to Sirens Forge Autopost.
- The success URL should include `connected=fanvue`.
- The URL should **not** include `error=fanvue_oauth_missing_required_scopes`.
- The URL should **not** include any other error.

Do not paste OAuth codes or full callback URLs if they contain codes, secrets, or other sensitive values.

Stop if the browser does not return with `connected=fanvue`.

## Human Step E — run safe token posture preflight only

Run only this safe token posture preflight from PowerShell:

```powershell
$env:DOTENV_CONFIG_PATH=".env.local"
npx tsx -r dotenv/config backend/autopost/admin/fanvuePostReconnectTokenPosturePreflight.ts --user-id "879c8a17-f9e8-473d-8de1-1fd1a77c080e"
```

This preflight:

- Reads stored connection posture.
- Outputs booleans and classifications only.
- Does not call Fanvue.
- Does not refresh tokens.
- Does not decrypt tokens.
- Does not upload.
- Does not post.
- Does not write Supabase data.

Do not run any upload, dispatch, post verification, or `/posts` command after this preflight.

## Human Step F — preflight values to check

The success target is:

```text
connection_status: CONNECTED
account_row_present: true
provider_account_id_present: true
provider_username_present: true
encrypted_access_token_present: true
encrypted_refresh_token_present: true
token_expires_at_present: true
token_freshness: fresh
metadata_provider_is_fanvue: true
metadata_identity_fetched: true
scopes_include_read_media: true
scopes_include_write_media: true
scopes_include_write_creator: false
scopes_include_openid: true
scopes_include_offline_access: true
scopes_include_offline: true
native_upload_readiness: ready
blockers: []
```

Stop conditions:

- If `encrypted_refresh_token_present` remains `false`, stop.
- If `scopes_include_offline_access` remains `false`, stop.
- If `token_freshness` is `expired` or `near_expiry` and the refresh token is missing, stop.
- If `scopes_include_read_media` is `false`, stop.
- If `scopes_include_write_media` is `false`, stop.
- If `connected=fanvue` did not happen in the browser reconnect step, stop.

Notes:

- `scopes_include_write_creator: false` is expected for this gate and is not the blocker.
- Do not summarize the scope posture as “scopes include read and write.” Use the exact scope fields above.
- Do not say “write is absent.” The relevant known state is that `write:media` is present and `write:creator` is absent.

## Human Step G — cleanup

Remove the temporary process-level dotenv setting:

```powershell
Remove-Item Env:DOTENV_CONFIG_PATH -ErrorAction SilentlyContinue
[Environment]::GetEnvironmentVariable("DOTENV_CONFIG_PATH", "Process")
```

Expected:

- The final command should print blank output.

## Result interpretation

### A. Best result

Observed:

```text
encrypted_refresh_token_present: true
scopes_include_openid: true
scopes_include_offline_access: true
scopes_include_offline: true
token_freshness: fresh
native_upload_readiness: ready
```

Next gate:

```text
FV-40AC — post-revoke reconnect result review, no upload
```

### B. Partial result

Observed:

```text
encrypted_refresh_token_present: true
```

But one or more of these are not reflected as `true`:

```text
scopes_include_openid
scopes_include_offline_access
scopes_include_offline
```

Next gate:

```text
FV-40AC — scope/refreshtoken mismatch review
```

### C. Failed result

Observed:

```text
encrypted_refresh_token_present: false
```

Next gate:

```text
FV-40AC — Fanvue support response / unresolved refresh-token issuance
```

### D. Error result

Observed:

```text
OAuth callback error
```

Next gate:

```text
FV-40AC — reconnect error review
```

## Launch safety conclusion

- Even if the preflight becomes `ready`, Fanvue native upload is still not public launch-ready until a separate upload-only gate is explicitly approved and passes.
- No `/posts` support is enabled by this runbook.
- No dispatch is enabled by this runbook.
- No public selectability is enabled by this runbook.
- No scheduling is enabled by this runbook.
- No fake `platform_post_id` should ever be created.
- No fake posting success should ever be created.
- `posted_proof` must remain false unless a separately approved future gate creates real proof through an approved workflow.
- Fanvue native launch readiness remains blocked until the human runbook proves refresh-token durability and a later approved gate reviews the result.
