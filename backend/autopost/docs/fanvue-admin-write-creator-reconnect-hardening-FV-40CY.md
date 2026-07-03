# FV-40CY — Fanvue admin-only write:creator reconnect hardening

This implementation hardens Fanvue OAuth reconnect initiation for the optional `write:creator` scope. It does **not** approve a reconnect, upload, post, dispatch, scheduling, or any public Fanvue launch behavior.

## Admin route

Dedicated route:

```text
POST /api/admin/autopost/fanvue/write-creator-reconnect/start
```

Required gates:

- authenticated user;
- user id allowlisted by `FANVUE_WRITE_CREATOR_RECONNECT_ADMIN_USER_IDS`;
- `x-fanvue-write-creator-reconnect-secret` matching `FANVUE_WRITE_CREATOR_RECONNECT_SECRET`;
- `operation: fanvue_write_creator_reconnect`;
- `confirm: REQUEST_FANVUE_WRITE_CREATOR_RECONNECT_ONLY_NO_UPLOAD_NO_POST`.

Preflight mode is `start: false` or missing. It returns safe booleans/classifications only and does not redirect.

Start mode is `start: true`. It is allowed only after all gates pass, creates signed OAuth state, sets the Fanvue OAuth cookie for the existing callback path, and redirects to the Fanvue authorize URL. It performs no server-side provider API call before redirect.

## Safe response boundary

Admin JSON responses are limited to the safe preflight/start fields:

- `operation`
- `fanvue_connect_enabled`
- `oauth_config_valid`
- `requested_scopes_present`
- `requested_scopes_include_write_creator`
- `default_scopes_include_write_creator`
- `required_connection_scopes_include_write_creator`
- `fanvue_public_selectable`
- `fanvue_dispatch_enabled`
- `fanvue_scheduling_enabled`
- `confirmation_required`
- `operation_allowed_for_admin`
- `will_call_fanvue_before_redirect`
- `will_upload`
- `will_post`
- `will_dispatch`
- `will_schedule`

Do not expose secrets, access tokens, refresh tokens, encrypted token values, OAuth codes, cookies, auth headers, signed URLs, client secrets, provider URLs, full scope lists, missing env details, or raw provider responses.

## Generic start hardening

`GET /api/autopost/connect/fanvue/start` remains the ordinary authenticated connect start route. If effective requested scopes include `write:creator`, it must not redirect and returns safe failure code `FANVUE_WRITE_CREATOR_RECONNECT_ADMIN_ROUTE_REQUIRED`.

## Callback hardening

Signed state distinguishes ordinary `fanvue_connect` from privileged `fanvue_write_creator_reconnect`. The callback keeps base required scopes unchanged: `read:self`, `read:media`, and `write:media`. `write:creator` is optional for ordinary connect and expected only for privileged reconnect. If privileged reconnect does not receive `write:creator`, the callback fails closed before overwriting the stored connection.

## Safety warnings

- This does not approve reconnect yet.
- This does not approve upload.
- This does not approve post.
- This does not approve dispatch.
- This does not approve scheduling.
- This does not expose Fanvue publicly.
- This does not change `platformRegistry`.
- This does not prove `creatorUserUuid`.
- `top_level_uuid` remains candidate-only and is not official `creatorUserUuid` proof.
- Refresh-only diagnostic must not be the first verification after reconnect.

## No-upload/no-post boundary

No signed upload URL acquisition, byte upload, finalize, media readiness polling, `/creators` live call, `/posts`, upload, post, dispatch, scheduling, public UI, or platform registry exposure is approved by this hardening.
