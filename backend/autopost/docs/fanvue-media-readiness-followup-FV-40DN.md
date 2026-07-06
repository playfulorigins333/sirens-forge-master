# FV-40DN — Fanvue media readiness follow-up diagnostic

## Decision

FV-40DN adds a separate admin-only media readiness follow-up diagnostic:

```text
POST /api/admin/autopost/fanvue/media-readiness-diagnostic
```

This is upload-readiness-only. It does not approve posting, dispatch, scheduling, public Fanvue exposure, `platformRegistry` changes, or any live execution without a separate approval gate.

## Required env/header/body

Required envs:

- `FANVUE_MEDIA_READINESS_DIAGNOSTIC_ADMIN_USER_IDS`
- `FANVUE_MEDIA_READINESS_DIAGNOSTIC_SECRET`

Required header:

- `x-fanvue-media-readiness-diagnostic-secret`

Required request body:

```json
{
  "operation": "fanvue_media_readiness_followup_diagnostic_no_post",
  "confirm": "RUN_FANVUE_MEDIA_READINESS_FOLLOWUP_DIAGNOSTIC_ONLY_NO_POST_NO_DISPATCH_NO_SCHEDULE_NO_PUBLIC_EXPOSURE",
  "user_id": "<target app user uuid>",
  "asset_profile": "safe_static_image_v1",
  "readiness_profile": "bounded_extended_v1"
}
```

`asset_profile` and `readiness_profile` are optional, but if supplied must match the exact values above.

## Behavior

The diagnostic may, only when separately approved for live execution:

- read the target Fanvue account row;
- decrypt the access token only in memory;
- call identity for the in-diagnostic creator UUID gate;
- classify top-level identity UUID as `top_level_uuid_confirmed_for_diagnostic_use` only;
- create a creator-scoped upload session;
- request a creator-scoped signed upload URL;
- upload one safe static diagnostic PNG;
- finalize the upload;
- perform bounded extended media readiness/readback classification.

The diagnostic uses a generated `64x64` PNG named `fanvue-media-readiness-diagnostic-safe-static-v1.png`. The asset contains only generated checkerboard pixels and no user content, adult content, identifying metadata, or production media.

## Bounded readiness strategy

- `maxAttempts`: 6
- `backoffBaseMs`: 5000
- `maxDelayMs`: 5000
- maximum total sleep: about 25000 ms

Tests inject sleep so mocked tests do not wait.

## Safe classifications

- `ready` / `FANVUE_MEDIA_READINESS_READY`
- `processing_timeout` / `FANVUE_MEDIA_READINESS_PROCESSING_TIMEOUT`
- `terminal_provider_error` / `FANVUE_MEDIA_READINESS_TERMINAL_PROVIDER_ERROR`
- `read_route_forbidden` / `FANVUE_MEDIA_READINESS_READ_FORBIDDEN`
- `read_route_not_found` / `FANVUE_MEDIA_READINESS_READ_NOT_FOUND`
- `route_or_id_mismatch_suspected` / `FANVUE_MEDIA_READINESS_ROUTE_OR_ID_MISMATCH_SUSPECTED`
- `malformed_readback` / `FANVUE_MEDIA_READINESS_READBACK_MALFORMED`
- `rate_limited` / `FANVUE_MEDIA_READINESS_RATE_LIMITED`
- `transient_provider_failure` / `FANVUE_MEDIA_READINESS_TRANSIENT_PROVIDER_FAILURE`
- `unknown_provider_failure` / `FANVUE_MEDIA_READINESS_UNKNOWN_PROVIDER_FAILURE`

## What remains blocked

- No `/posts`.
- No post creation.
- No dispatch.
- No scheduling.
- No public UI exposure.
- No `platformRegistry` changes.
- No launch-facing platform selection.
- No Supabase mutation beyond the existing diagnostic read-only account lookup behavior.
- No signed URL, token, raw provider body, byte output, ETag, full creator UUID, full upload ID, full media UUID, username, handle, email, base64 media content, or media file content output.

## Creator UUID boundary

`top_level_uuid` remains diagnostic-scoped only. It is not globally proven `creatorUserUuid`. This implementation does not approve posting, and `/posts` remains blocked.

## STOP

Do not run this route live from an implementation PR. Do not call Fanvue from Codex. Do not upload, post, dispatch, schedule, reconnect, revoke, change envs, change Supabase, run SQL, or expose Fanvue publicly.
