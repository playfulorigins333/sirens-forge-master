# FV-40DJ — Fanvue upload diagnostic preflight

## Decision

FV-40DJ adds a safe preflight-only mode to the existing admin route:

```text
POST /api/admin/autopost/fanvue/upload-diagnostic
```

Green preflight is not live upload approval. The live upload diagnostic still requires a separate explicit approval gate.

## Required env/header/body

Required envs:

- `FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_USER_IDS`
- `FANVUE_UPLOAD_DIAGNOSTIC_SECRET`

Required header:

- `x-fanvue-upload-diagnostic-secret`

Required preflight body:

```json
{
  "operation": "fanvue_creator_scoped_upload_diagnostic_no_post",
  "confirm": "PREFLIGHT_FANVUE_UPLOAD_DIAGNOSTIC_ONLY_NO_PROVIDER_CALL_NO_UPLOAD_NO_POST",
  "preflight": true,
  "user_id": "<target app user uuid>"
}
```

The preflight confirmation is intentionally different from the live diagnostic confirmation.

## What preflight does

Preflight validates admin authentication, the diagnostic secret, the exact operation, the exact preflight confirmation, the target user UUID, and the same forbidden creator/post/dispatch/scheduling/platform-exposure fields as the full route.

Preflight loads only the stored Fanvue `autopost_accounts` row for the target user and returns booleans/classifications from that row:

- account row presence;
- connected status;
- provider account ID presence;
- provider username presence;
- encrypted access token presence;
- encrypted refresh token presence;
- token expiry presence and freshness classification;
- stored metadata provider/identity/creator flags;
- `read:media`, `write:media`, and `write:creator` scope presence;
- `ready_for_live_upload_diagnostic_gate` and blockers.

## What preflight does not do

- It does not call Fanvue.
- It does not decrypt tokens.
- It does not upload.
- It does not request signed upload URLs.
- It does not finalize media.
- It does not poll readiness.
- It does not post.
- It does not dispatch or schedule.
- It does not make Fanvue public.
- It does not touch `platformRegistry`.
- It does not call `/creators` or `/posts` live.

## Safe output

Preflight returns safe booleans, classifications, safe codes, and blockers only. It must not return secrets, access tokens, refresh tokens, encrypted token values, OAuth codes, cookies, auth headers, signed URLs, raw provider responses, byte upload output, media contents, full creator UUIDs, upload IDs, media UUIDs, ETags, usernames, handles, or emails.

## Boundaries

`/posts` remains blocked. Post creation remains blocked. Dispatch remains blocked. Scheduling remains blocked. Fanvue remains internal/testing-only and not public-selectable.
