# FV-40DB — Fanvue write:creator reconnect browser-safe start runbook

## Decision

FV-40DB is unblocked by `response_mode: "json_redirect"` on the existing admin-only POST route:

```text
POST /api/admin/autopost/fanvue/write-creator-reconnect/start
```

The route remains admin-only, POST-only, and protected by the `x-fanvue-write-creator-reconnect-secret` header. The JSON redirect mode preserves every existing gate and returns a same-origin JSON instruction with `redirect_url` only after those gates pass.

Do not use fetch-followed redirects for OAuth consent. The browser-safe flow is: fetch JSON, inspect the safe booleans, then manually run `window.location.assign(json.redirect_url)`.

## Required request body for start

```json
{
  "operation": "fanvue_write_creator_reconnect",
  "confirm": "REQUEST_FANVUE_WRITE_CREATOR_RECONNECT_ONLY_NO_UPLOAD_NO_POST",
  "start": true,
  "response_mode": "json_redirect"
}
```

## Safe browser-console flow

1. Run preflight with `start:false`.
2. Confirm green booleans.
3. Do not paste the secret into chat.
4. Do not change `start:false` to `start:true` until final approval.
5. Run `start:true` with `response_mode:"json_redirect"` one time only.
6. Confirm the JSON has `type: "fanvue_write_creator_reconnect_redirect"`.
7. Confirm `will_call_fanvue_before_redirect` is `false`.
8. Confirm `will_upload`, `will_post`, `will_dispatch`, and `will_schedule` are all `false`.
9. Run `window.location.assign(json.redirect_url)` manually.
10. Approve only the OAuth consent on Fanvue.
11. After return, do not run refresh.
12. After return, do not upload/post/dispatch/schedule.
13. First verification after reconnect must be row-only/preflight-only.

## Console template

```js
(async () => {
  const secret = prompt("Fanvue write:creator reconnect secret — do not paste into chat");
  if (!secret) throw new Error("Missing secret");

  const preflightRes = await fetch("/api/admin/autopost/fanvue/write-creator-reconnect/start", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "x-fanvue-write-creator-reconnect-secret": secret,
    },
    body: JSON.stringify({
      operation: "fanvue_write_creator_reconnect",
      confirm: "REQUEST_FANVUE_WRITE_CREATOR_RECONNECT_ONLY_NO_UPLOAD_NO_POST",
      start: false,
    }),
  });
  const preflight = await preflightRes.json();
  console.log("preflight", { status: preflightRes.status, preflight });

  // Stop here until final approval. Do not run start:true more than once.

  const startRes = await fetch("/api/admin/autopost/fanvue/write-creator-reconnect/start", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "x-fanvue-write-creator-reconnect-secret": secret,
    },
    body: JSON.stringify({
      operation: "fanvue_write_creator_reconnect",
      confirm: "REQUEST_FANVUE_WRITE_CREATOR_RECONNECT_ONLY_NO_UPLOAD_NO_POST",
      start: true,
      response_mode: "json_redirect",
    }),
  });
  const json = await startRes.json();
  console.log("start", { status: startRes.status, json });

  if (json.type !== "fanvue_write_creator_reconnect_redirect") throw new Error("Unexpected start response type");
  if (json.will_call_fanvue_before_redirect !== false) throw new Error("Unexpected provider-call flag");
  if (json.will_upload || json.will_post || json.will_dispatch || json.will_schedule) throw new Error("Unexpected write flag");

  window.location.assign(json.redirect_url);
})();
```

## Post-reconnect verification order

First verification after reconnect must be row-only/preflight-only. Refresh-only diagnostic must not be first verification. No provider call. No refresh call. No upload/post/dispatch/scheduling. No raw provider response. No token values.

## CreatorUserUuid boundary

`top_level_uuid` remains candidate-only. Reconnect does not prove `creatorUserUuid`. Post-reconnect preflight does not prove `creatorUserUuid`. Upload diagnostic remains blocked. `/creators` live remains blocked. `/posts` remains blocked.
