# FV-40J — Fanvue media upload official contract research

This docs-only gate records public Fanvue contract evidence for native media upload session creation and compares it with the existing mocked scaffold. It does not approve a live upload attempt, does not change runtime behavior, and does not call Fanvue/provider APIs.

## Safety scope

FV-40J was limited to repository inspection and public documentation search. No Fanvue OAuth, identity, upload, post, Supabase, SQL, or provider endpoint was called.

## External public sources checked

| Source | URL | Official Fanvue source | Authentication required | Useful upload contract proof |
| --- | --- | --- | --- | --- |
| Fanvue API Documentation — Create multipart upload session | `https://api.fanvue.com/docs/api-reference/reference/media/create-upload-session` | Yes | No | Yes: connected-user upload session route, headers, scopes, body, and response fields. |
| Fanvue API Documentation — Complete upload session | `https://api.fanvue.com/docs/api-reference/complete-upload-session` | Yes | No | Yes: connected-user completion route, method, headers, scope, body, and response status values. |
| Fanvue API Documentation — Create multipart upload session for creator | `https://api.fanvue.com/docs/api-reference/create-multipart-upload-session-for-creator` | Yes | No | Yes: agency/creator-scoped upload session route and extra `write:creator` requirement. |
| Fanvue API Documentation — Get signed URL for upload part | `https://api.fanvue.com/docs/api-reference/get-signed-url-for-upload-part` | Yes | No | Yes, but the indexed page currently documents a creator-scoped signed URL path requiring `creatorUserUuid`, `write:creator`, and `write:media`. |
| Fanvue API Documentation — Authentication Overview | `https://api.fanvue.com/docs/authentication/overview` | Yes | No | Yes: API base URL, OAuth bearer token format, token lifetime, and 401-on-expired-token behavior. |
| Fanvue API Documentation — API Versioning | `https://api.fanvue.com/docs/versions/overview` | Yes | No | Yes: required `X-Fanvue-API-Version` header and current API version. |
| Fanvue API Documentation — Scopes | `https://api.fanvue.com/docs/authentication/scopes` | Yes | No | Yes: scope meanings for `read:media`, `write:media`, and `write:creator`. |
| Fanvue API Documentation — Get media by UUID | `https://api.fanvue.com/docs/api-reference/get-media-by-uuid` | Yes | No | Yes: connected-user media readback route and response behavior. |
| Fanvue API Documentation — Get user's media list | `https://api.fanvue.com/docs/api-reference/get-users-media-list` | Yes | No | Yes: connected-user media list/readback family and required API headers. |
| Fanvue API docs LLM bundle | `https://api.fanvue.com/docs/llms-full.txt` | Yes | Public URL, but direct CLI fetch was blocked by tunnel 403 in this environment | No direct proof captured by CLI; search index snippets were available. |

## Contract facts proven by official public Fanvue docs

1. **API base URL:** Fanvue's authentication overview says API calls use `https://api.fanvue.com` with `Authorization: Bearer <token>` after OAuth.
2. **OAuth authorization and token URLs:** The same overview identifies `https://auth.fanvue.com/oauth2/auth` and `https://auth.fanvue.com/oauth2/token` for OAuth.
3. **Connected-user upload session endpoint:** Fanvue documents `POST /media/uploads` for “Create multipart upload session.”
4. **Connected-user upload body:** The documented upload-session JSON body requires `name`, `filename`, and `mediaType`; `mediaType` is one of `image`, `video`, `audio`, or `document`.
5. **Connected-user upload auth/scope:** The documented connected-user upload-session endpoint requires an OAuth bearer token and `write:media`.
6. **Upload-session response:** The successful upload-session response contains `mediaUuid` and `uploadId`.
7. **Required headers/versioning:** Fanvue documents `Authorization: Bearer <token>`, `Content-Type: application/json` for JSON upload-session/completion requests, and required `X-Fanvue-API-Version`; the current documented version is `2025-06-26`.
8. **Connected-user upload completion endpoint:** Fanvue documents `PATCH /media/uploads/{uploadId}` to complete multipart upload and set media status to processing.
9. **Connected-user upload completion body:** Fanvue documents a JSON body with `parts` for completion.
10. **Creator-scoped/agency upload session endpoint:** Fanvue separately documents `POST /creators/{creatorUserUuid}/media/uploads`, requiring `write:creator` and `write:media`.
11. **Creator-scoped signed URL endpoint evidence:** The public indexed “Get signed URL for upload part” page currently shows `GET /creators/{creatorUserUuid}/media/uploads/{uploadId}/parts/{partNumber}/url`, requiring `write:creator` and `write:media`.
12. **Media readback:** Fanvue documents `GET /media/{uuid}` for a connected user's media item; media not finalised returns only UUID/status, and finalised media returns full details.
13. **401 interpretation:** Fanvue's authentication overview states access tokens are typically valid for about one hour and the API responds with `401 Unauthorized` when the access token expires.

## Current scaffold assumptions still unproven or newly narrowed

- `POST /media/uploads`: now proven for connected-user upload-session creation by official docs, but still not proven as sufficient for the later signed-URL route in this repo's full flow.
- `{ name, filename, mediaType }`: now proven as the connected-user upload-session body by official docs.
- No creator/account context for upload-session creation: now proven for the connected-user upload-session route, but not proven for the signed-URL step because the indexed signed-URL source currently shows a creator-scoped route.
- No MIME type: official upload-session docs do not list a MIME type field.
- No file size: official upload-session docs do not list a file-size or byte-length field.
- No purpose: official upload-session docs do not list a purpose field.
- No checksum: official upload-session docs do not list a checksum field.
- `X-Fanvue-API-Version` as only versioning: Fanvue official versioning docs prove this header is required; no URL version prefix was found in the checked upload docs.
- No `Accept` header: checked Fanvue upload cURL examples do not show `Accept`, but absence from examples is weaker than an explicit “not required” statement.
- API base fallback safety: `https://api.fanvue.com` is now officially documented as the API base, but the repo's fallback from `FANVUE_API_BASE_URL` to `FANVUE_API_BASE` to the default remains a local safety/design choice, not an official live-upload safety guarantee.
- `write:media` sufficient without `write:creator`: proven for connected-user `POST /media/uploads`; not proven for every subsequent upload-flow step because the indexed signed-URL page currently shows creator-scoped requirements.

## Contract conflicts found

1. The current mocked signed-part route assumes `GET /media/uploads/{uploadId}/parts/{partNumber}/url`, while the official indexed signed-URL page found during FV-40J shows `GET /creators/{creatorUserUuid}/media/uploads/{uploadId}/parts/{partNumber}/url` with `write:creator` and `write:media`.
2. The current mocked client limits upload-session `mediaType` to `image` or `video`; official upload-session docs also list `audio` and `document`. This is a conservative local scaffold limit, not necessarily a live-contract conflict for the initial photo-only test.
3. The current scaffold uses lowercase `authorization`; Fanvue examples and auth docs display `Authorization`. HTTP header names are case-insensitive, and FV-40F already showed casing did not resolve the live 401, so this is not treated as a proven conflict.

## Most likely explanation for the known 401 at `POST /media/uploads`

Evidence-ranked, without guessing beyond the checked contract:

1. **Expired or otherwise invalid OAuth access token** — proven possible by Fanvue auth docs, which state expired access tokens receive `401 Unauthorized`.
2. **Token audience/app authorization problem** — plausible under OAuth, but not specifically proven for this upload endpoint by checked docs.
3. **Missing `write:media`** — official upload-session docs require `write:media`, but the current known scope fact says `write:media` is present, so this is not supported as the leading explanation for the recorded 401.
4. **Missing `write:creator`** — not supported for connected-user `POST /media/uploads`, because official docs list only `write:media` for that endpoint; it may become relevant for creator-scoped upload routes or the signed-URL page found in the public index.
5. **Wrong endpoint path/base/version header/body shape** — less supported for the first failing request because official docs match `https://api.fanvue.com`, `POST /media/uploads`, JSON `{ name, filename, mediaType }`, and `X-Fanvue-API-Version`. Version value freshness remains dependent on deployment configuration.

## Recommended next gate

FV-40K should be a docs/support request pack or mocked-contract alignment gate, not a live upload. The smallest safe next step is to document the official connected-user upload-session proof and ask Fanvue support/docs to clarify the non-creator signed-part URL and whether connected-user multipart upload has a complete route set that does not require `creatorUserUuid`/`write:creator`.

Do not run a live upload until the signed-URL route and token freshness/audience checks are resolved in a separate approved gate.
