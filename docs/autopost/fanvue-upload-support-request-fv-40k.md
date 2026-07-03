# FV-40K — Fanvue upload support/docs request pack

## Internal summary

This docs-only support pack is for asking Fanvue developer/support to clarify the remaining native media upload contract questions before any further live upload attempt. It is a support-prep gate only.

This document does not approve any runtime behavior change:

- No live upload is approved by this document.
- No posting is approved by this document.
- No dispatch wiring is approved by this document.
- No public selectability or scheduling is approved by this document.

Known scope facts for the connected account must be stated exactly as follows:

- `read:media` is present.
- `write:media` is present.
- `write:creator` is absent.

## Fanvue support message draft

Subject: Clarification request: connected-user native media upload contract returns 401 at `POST /media/uploads`

Hello Fanvue Developer/Support team,

We are implementing Fanvue native media upload using OAuth for upload-only media handling first, not post creation. We would like to confirm the connected-user upload contract before attempting another live upload.

App/account context, using placeholders only:

- App/client: `[APP_CLIENT_ID_OR_APP_NAME]`
- Connected creator/account: `[CONNECTED_CREATOR_USERNAME]`
- Connected user UUID, if safe to share: `[CONNECTED_USER_UUID_IF_SAFE_TO_SHARE]`
- Request ID, if available: `[REQUEST_ID_IF_AVAILABLE]`
- Timestamp, if available: `[TIMESTAMP_IF_AVAILABLE]`

The connected OAuth account has the following scopes:

- `read:media` is present.
- `write:media` is present.
- `write:creator` is absent.

The connected-user upload session request is failing at `POST /media/uploads` with 401. No signed upload URL is reached. No bytes are uploaded. No completion call is reached. No post is created. We are trying to implement upload-only first, not post creation.

Safe failure output:

```json
{
  "ok": false,
  "blocked": true,
  "error_code": "FANVUE_UNAUTHORIZED",
  "safe_error_message": "Fanvue rejected the request authorization.",
  "provider_calls_attempted": true,
  "posted_proof": false,
  "platform_post_id": null,
  "failed_step": "create_upload_session",
  "provider_status": 401,
  "provider_error_code": "FANVUE_UNAUTHORIZED",
  "provider_route": "POST /media/uploads"
}
```

Could you please confirm the questions below so we can align our implementation with Fanvue's official connected-user upload contract without exposing tokens or secrets?

### A. Connected-user upload session

1. Is `POST /media/uploads` the correct route for connected-user media upload session creation?
2. Is `write:media` sufficient for this route without `write:creator`?
3. Should an OAuth access token from the normal reconnect/callback flow work for this route?
4. Does this route require any account/creator/user context in path, headers, or body?
5. Does this route require `Accept: application/json`?

### B. Token/audience/authorization

1. Can a token work for `GET /users/account` but return 401 for `POST /media/uploads`?
2. If yes, what are the common causes?
3. Does this indicate expired token, wrong audience, app permission issue, missing grant, creator account restriction, or missing scope?
4. Does Fanvue require token refresh immediately before media upload?
5. Are access tokens valid for about one hour, and should refresh-token flow be used before upload if expired?

### C. Signed URL route

1. For connected-user upload, what is the correct signed-part URL route after `POST /media/uploads`?
2. Is there a connected-user route like `GET /media/uploads/{uploadId}/parts/{partNumber}/url`?
3. Or is the only signed-part URL route creator-scoped: `GET /creators/{creatorUserUuid}/media/uploads/{uploadId}/parts/{partNumber}/url`?
4. If creator-scoped, does that mean connected-user uploads still require `write:creator` for the signed-URL step?
5. If connected-user uploads do not require `write:creator`, what exact signed-URL endpoint should be used?

### D. Completion/readback

1. Is `PATCH /media/uploads/{uploadId}` correct for connected-user upload completion?
2. What exact completion body is required?
3. Is `GET /media/{uuid}` correct for connected-user readback after completion?
4. What status values should be expected before and after processing?

### E. App/client permissions

1. Does the app/client need specific approval from Fanvue to use media upload endpoints?
2. Can Fanvue confirm whether our app/client is authorized for native media upload?
3. Does upload-session creation require a separate product entitlement or partner flag beyond OAuth scopes?

### F. API version/base

1. Is `https://api.fanvue.com` the correct base for all connected-user media upload steps?
2. Is `X-Fanvue-API-Version: 2025-06-26` currently valid for upload session, signed URL, completion, and readback?
3. Are any upload endpoints versioned through the URL path instead of only the header?

Thank you for helping us confirm the upload-only contract before we proceed.

## Questions for Fanvue

The copy/paste support message above includes these exact question categories:

- Connected-user upload session.
- Token/audience/authorization.
- Signed URL route.
- Completion/readback.
- App/client permissions.
- API version/base.

## Internal next-step decision matrix

| Fanvue response | Next smallest safe gate |
| --- | --- |
| Token expired | Mocked token freshness/refresh preflight. |
| Wrong audience/app entitlement | App authorization/support follow-up, not code. |
| `write:creator` is required | OAuth scope/authorization strategy review, not live upload. |
| Different signed URL route | Mocked contract alignment tests/code fix. |
| Current contract is correct and app is authorized | Controlled single-command live upload attempt only after human approval. |

## Safe status

- Fanvue native upload remains blocked.
- Optional `write:creator` requestability, if configured in a later internal OAuth scope gate, is broader access only; it does not approve upload, signed URL acquisition, byte upload, finalize/readiness polling, post creation, dispatch, scheduling, public platform selectability, or public Fanvue UI exposure.
- No future live upload is approved by this document.
- No public user impact.
- No dispatch/posting integration.
- No `/posts`.
- Next action is support clarification or mocked alignment only.
