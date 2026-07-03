# FV-40DF — Fanvue creatorUserUuid proof and upload diagnostic design

## Decision

SAFE TO DESIGN UPLOAD DIAGNOSTIC.

FV-40DF approved only the design of a future admin-only diagnostic. It did not approve live upload execution, posting, dispatch, scheduling, public Fanvue exposure, `/posts`, or production route calls.

## Diagnostic-scoped creatorUserUuid proof

`top_level_uuid` from the Fanvue identity response is not globally proven as `creatorUserUuid`. For FV-40DG only, it may be used to construct creator-scoped diagnostic paths when all fail-closed checks pass:

- the identity endpoint returns a 2xx response;
- top-level `uuid` is present;
- top-level `uuid` is UUID-format valid;
- `isCreator === true`;
- candidate source is classified as `top_level_uuid`;
- if stored `provider_account_id` is UUID-shaped, it matches the top-level identity UUID;
- the raw UUID is used only in memory and never returned.

When used, the safe classification is `top_level_uuid_confirmed_for_diagnostic_use`, not globally proven creatorUserUuid.

## Route choice

The upload diagnostic should use the creator-scoped route family:

- `POST /creators/{creatorUserUuid}/media/uploads`
- `GET /creators/{creatorUserUuid}/media/uploads/{uploadId}/parts/{partNumber}/url`

The general `POST /media/uploads` route remains documented as connected-user upload-session evidence requiring `write:media`, but it is not the recommended full diagnostic route because signed upload URL evidence is creator-scoped.

## Hard boundary

FV-40DG must stop after upload mechanics proof. `/posts` remains blocked. Dispatch remains blocked. Scheduling remains blocked. Fanvue remains internal/testing-only and not public-selectable.
