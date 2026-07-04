# FV-40DG — Fanvue upload diagnostic implementation runbook

## Status

FV-40DG adds a mocked/tested admin-only route implementation for a future Fanvue creator-scoped upload diagnostic:

```text
POST /api/admin/autopost/fanvue/upload-diagnostic
```

This implementation does not approve live upload execution. Future live execution requires a separate explicit approval gate.

## Required env/header/body

Required envs:

- `FANVUE_UPLOAD_DIAGNOSTIC_ADMIN_USER_IDS`
- `FANVUE_UPLOAD_DIAGNOSTIC_SECRET`

Required header:

- `x-fanvue-upload-diagnostic-secret`

Required request body:

```json
{
  "operation": "fanvue_creator_scoped_upload_diagnostic_no_post",
  "confirm": "RUN_FANVUE_CREATOR_SCOPED_UPLOAD_DIAGNOSTIC_ONLY_NO_POST_NO_DISPATCH_NO_SCHEDULE_NO_PUBLIC_EXPOSURE",
  "user_id": "<target app user uuid>"
}
```

Do not include caller-supplied `creatorUserUuid`, post fields, captions, audience, publish times, collections, dispatch/scheduling fields, platform exposure fields, or `/posts` paths.

## What the diagnostic may do in a separately approved future live run

- read the target Fanvue account row;
- decrypt the access token only in memory;
- call identity for the in-diagnostic creator UUID gate;
- create a creator-scoped upload session;
- request a creator-scoped signed upload URL;
- upload one deterministic tiny diagnostic object;
- finalize the upload;
- perform bounded media readiness/readback classification.

## What remains blocked

- No `/posts`.
- No post creation.
- No dispatch.
- No scheduling.
- No public UI exposure.
- No `platformRegistry` changes.
- No launch-facing platform selection.
- No signed URL, token, raw provider body, byte output, ETag, full creator UUID, full upload ID, full media UUID, username, handle, or email output.

## Safe output

The route returns booleans and classifications only. Provider status class may be returned. Sensitive material must never be returned or logged.


## FV-40DJ preflight-only mode

FV-40DJ adds a preflight-only mode to the same admin route. Use `preflight: true` with confirmation `PREFLIGHT_FANVUE_UPLOAD_DIAGNOSTIC_ONLY_NO_PROVIDER_CALL_NO_UPLOAD_NO_POST` to validate env/auth/body and stored account readiness before any live upload diagnostic is separately approved.

Preflight does not call Fanvue, decrypt tokens, upload, request signed upload URLs, finalize media, poll readiness, post, dispatch, schedule, expose Fanvue publicly, or touch `platformRegistry`. A green preflight is not live upload approval. The live upload diagnostic still requires a separate gate. `/posts` remains blocked.

## STOP

Do not run this route live from an implementation PR. Do not call Fanvue from Codex. Do not upload, post, dispatch, schedule, reconnect, revoke, change envs, change Supabase, run SQL, or expose Fanvue publicly.
