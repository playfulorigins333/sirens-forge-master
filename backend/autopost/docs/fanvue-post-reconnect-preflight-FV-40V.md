# FV-40V — Fanvue post-reconnect token posture preflight

FV-40V adds a local/admin-only preflight for inspecting the stored Fanvue `autopost_accounts` posture after a manual reconnect and before any future upload-only retry gate.

## Safety posture

This preflight outputs JSON booleans/classifications only. It does **not** print access tokens, refresh tokens, encrypted token values, OAuth codes, client secrets, Supabase keys, signed URLs, cookies, authorization headers, or raw provider responses.

It does **not** approve live upload. A `ready_for_upload_only_gate` result only means the stored row posture appears sufficient for the next separately approved upload-only gate. It is not permission to upload, post, dispatch, schedule, verify, or call Fanvue.

The preflight does not call Fanvue APIs, the Fanvue token endpoint, identity/self endpoints, upload session endpoints, signed URL endpoints, completion endpoints, media readback endpoints, or `/posts`. It does not decrypt tokens, refresh tokens, create OAuth codes, initiate browser OAuth reconnect, create posts, modify Supabase data, run SQL, create migrations, or change Vercel/environment variables.

## When to run

Run FV-40V only after a human-approved Fanvue manual reconnect and before any FV-40W/FV-40X upload-only retry planning.

Command shape:

```bash
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config backend/autopost/admin/fanvuePostReconnectTokenPosturePreflight.ts --user-id <uuid>
```

Do not run this command from Codex against production data. Use it only in the intended local/admin context.

## Readiness result

`native_upload_readiness` is `ready_for_upload_only_gate` only when all safe posture checks pass:

- Fanvue account row exists for the user.
- `connection_status` is `CONNECTED`.
- Provider account id is present.
- Encrypted access token is present.
- Encrypted refresh token is present.
- Token expiry is present and classified `fresh`, outside the five-minute FV-40M freshness buffer.
- `metadata.provider` is `fanvue`.
- `metadata.identity_fetched` is `true`.
- Stored scopes include `read:media`.
- Stored scopes include `write:media`.

`write:creator` is reported as a boolean but is not required and must not block connected-user upload-only readiness.

If the preflight returns `blocked`, do not run upload. If it returns `ready_for_upload_only_gate`, the safer next split is:

1. **FV-40W** — run this safe preflight locally/admin-only.
2. **FV-40X** — controlled upload-only live retry only after FV-40W is ready and a human explicitly approves the live retry.

## FV-40CY verification warning

After any separately approved future admin-only `write:creator` reconnect, verification must remain row-only/preflight-only and confirm `scopes_include_write_creator: true`, `scopes_include_read_media: true`, `scopes_include_write_media: true`, and `connection_status: CONNECTED`. Do not call Fanvue, refresh, upload, post, dispatch, schedule, expose raw provider responses, expose token values, or expose encrypted token values. Refresh-only diagnostic must not be the first verification after reconnect. This does not prove `creatorUserUuid`; `top_level_uuid` remains candidate-only.

## FV-40DG follow-up

`write:creator` is required for the FV-40DG creator-scoped upload diagnostic route design. The row-only preflight still does not prove `creatorUserUuid`, does not approve live upload execution, does not approve posting, does not approve dispatch/scheduling, and does not make Fanvue public. `/posts` remains blocked.
