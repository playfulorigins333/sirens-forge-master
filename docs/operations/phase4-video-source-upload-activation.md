# Phase 4 Video source-upload infrastructure activation

`VIDEO_SOURCE_UPLOAD_INFRA_READY` is a server-only manual-verification latch and defaults to `false`. It may be set to exact lowercase `true` only after an operator has verified all of the following on the real private creator-generation bucket:

- The bucket remains private with no public object or directory exposure.
- CORS permits browser `PUT` from the canonical Production application origin.
- Any Preview or testing origin is intentionally enumerated, time-bounded, and reviewed; wildcard origins are not acceptable.
- CORS permits the `Content-Type` request header and no broader methods or headers than required.
- The upload credential is scoped only to staging PUT, server-side promotion/copy, and staging deletion for the designated prefixes.
- The existing creator-generation read credential remains separately scoped to private verification/read operations.
- A lifecycle rule removes abandoned objects under `creator-video-source-staging/` after the approved retention period.
- A real browser preflight and staging PUT have been verified without making the bucket public.

This repository change does not configure Cloudflare R2. Keep the latch false until CORS, credential scopes, and lifecycle cleanup have been manually confirmed in the target environment.
