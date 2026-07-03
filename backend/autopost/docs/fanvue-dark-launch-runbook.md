# Fanvue Production Dark-Launch Runbook

## A. Current status

Fanvue native posting is **not publicly launched**.

Current product state:

- Fanvue remains assisted/manual only in the running product.
- Fanvue remains non-selectable.
- Fanvue remains non-schedulable.
- No public Fanvue run path exists.
- No Fanvue jobs can run.
- No Fanvue media upload exists.
- No live Fanvue post has been made by Sirens Forge automation.
- This branch only adds gated foundations for OAuth, status, drafts, adapter request shaping, proof validation, and schedule-safety checks.

This branch must not be described as public Fanvue Autopost enablement.

## B. Safety gates

Required safe defaults and invariants:

- `FANVUE_CONNECT_ENABLED=false`
- `FANVUE_RUN_DISPATCH_ENABLED=false`
- `FANVUE_POST_VERIFY_ENABLED=false`
- Fanvue `public_selectable=false`
- Fanvue `can_schedule=false`
- Fanvue `supports_real_posting=false`
- Fanvue `supports_text_posting=false` in public scheduling/status
- Fanvue `supports_media_posting=false` in public scheduling/status
- Fanvue `supports_async_dispatch=false`
- Fanvue `native_posting_available=false`
- No schedule advancement without strict live proof.
- No `platform_post_id` unless it is the official Fanvue post UUID/id.
- No `POSTED` unless strict live proof validates.
- `SCHEDULED_CREATED` is not `POSTED`.
- `POSTED_READY_FOR_PROOF` is not persisted proof by itself.

## C. Required Fanvue app settings later

A human will eventually configure Fanvue Builder settings. Do not include secrets in this repo.

Known app shell:

- App name: `Sirens Forge Autopost Internal Test`

Redirect URI path:

```text
/api/autopost/connect/fanvue/callback
```

Future production redirect URI format:

```text
https://<production-domain>/api/autopost/connect/fanvue/callback
```

Future local redirect URI format, only if Fanvue allows localhost:

```text
http://localhost:3000/api/autopost/connect/fanvue/callback
```

Required scopes:

```text
read:self
read:creator
read:post
write:post
read:media
write:media
```

Hard warning: never paste Fanvue Client Secret into Codex, GitHub, docs, logs, screenshots, chat, tickets, PR bodies, or terminal output.

## D. Required env vars later

Use placeholders only. Do not commit real values.

| Env var | Secret? | Safe default / placeholder | Notes |
| --- | --- | --- | --- |
| `FANVUE_CONNECT_ENABLED` | No | `false` | Enables OAuth connect only when explicitly set to `true`. |
| `FANVUE_RUN_DISPATCH_ENABLED` | No | `false` | Must stay false until protected dispatch/proof/runbook gates are complete. |
| `FANVUE_POST_VERIFY_ENABLED` | No | `false` | Reserved for later proof/read-back verification. |
| `FANVUE_CLIENT_ID` | Treat as sensitive config | empty | Store only in deployment secrets/config, not docs. |
| `FANVUE_CLIENT_SECRET` | Yes | empty | Store only in secret manager/deployment secrets. Never paste into Codex or GitHub. |
| `FANVUE_REDIRECT_URI` | No | empty | Must exactly match Fanvue Builder redirect URI. |
| `FANVUE_OAUTH_SCOPES` | No | `read:self read:creator read:post write:post read:media write:media` | Must stay within approved scopes. |
| `FANVUE_API_BASE_URL` | No | empty | Official Fanvue API base URL. |
| `FANVUE_OAUTH_AUTHORIZE_URL` | No | empty | Official Fanvue OAuth authorize URL. |
| `FANVUE_OAUTH_TOKEN_URL` | No | empty | Official Fanvue OAuth token URL. |
| `FANVUE_API_VERSION` | No | empty | Official API version/header value. |
| `AUTOPOST_TOKEN_ENCRYPTION_KEY` | Yes | existing secret | Base64 32-byte key for provider token encryption. |
| `AUTOPOST_TOKEN_KEY_VERSION` | No | existing value | Token key version for rotation. |
| `AUTOPOST_OAUTH_STATE_SECRET` | Yes | existing secret | Signs OAuth state cookies. |
| `AUTOPOST_INTERNAL_ADAPTER_SECRET` | Yes | existing secret | Server-to-server adapter auth; do not expose to browsers. |

## E. Pre-merge checklist

Before merging the gated branch/package:

- Review the full diff.
- Verify no real credentials are in files.
- Verify no Fanvue run-route wiring exists.
- Verify no Fanvue public selectability exists.
- Verify no Fanvue schedulability exists.
- Verify no Fanvue `POSTED` persistence path is publicly reachable.
- Verify no Fanvue `SCHEDULED` status or migration is included.
- Verify no migrations/SQL are included for Fanvue.
- Verify tests pass.
- Verify the PR body is honest: foundations only, not launch.
- Verify any `npm run build` failure, if present, is unrelated runtime config only and not caused by Fanvue code.

## F. Post-merge dark-launch checklist

For later, after human approval and merge, use this exact order:

1. Confirm production backup status before any future SQL, even though this pass has no SQL.
2. Confirm Fanvue app redirect URI exactly matches the production env value.
3. Add Fanvue env vars in the deployment platform, keeping all gates OFF first.
4. Deploy with `FANVUE_CONNECT_ENABLED=false`.
5. Confirm Fanvue remains assisted/manual in production.
6. Confirm Fanvue remains non-selectable/non-schedulable.
7. Enable only `FANVUE_CONNECT_ENABLED=true` for an internal admin test when ready.
8. Test OAuth connect with an internal account only.
9. Confirm connected status requires real identity and encrypted token storage.
10. Keep `FANVUE_RUN_DISPATCH_ENABLED=false`.
11. Do not attempt live posting.
12. Do not enable public selectability.

## G. Internal OAuth test plan

Later manual OAuth test steps:

- Use an internal/admin account only.
- Click/connect only after redirect URI and env vars are configured.
- Confirm Fanvue OAuth consent shows expected scopes.
- Confirm callback succeeds.
- Confirm status shows connected only if identity is verified.
- Confirm tokens are not exposed in browser, logs, docs, or response payloads.
- Confirm disconnect works and clears encrypted token fields.
- Confirm X behavior is unaffected.
- Confirm Fanvue remains non-schedulable.
- Confirm `FANVUE_RUN_DISPATCH_ENABLED=false` throughout OAuth-only testing.

## H. Future live-post test blockers

Live Fanvue posting is still blocked until later work and human approval.

Current blockers:

- No public run path.
- No Fanvue dispatch gate enabled.
- No job/result persistence path for Fanvue live proof is wired into the runner.
- FV-8 schedule guard requires proof correlation fields, but those are not yet added to the Fanvue proof validator output.
- Media upload remains deferred.
- Scheduled-post live verification remains deferred.
- No final enablement decision has been made.
- No dark-launch live-post runbook has been executed.

## I. Rollback plan

If anything looks wrong during dark launch:

1. Turn `FANVUE_CONNECT_ENABLED=false`.
2. Keep or set `FANVUE_RUN_DISPATCH_ENABLED=false`.
3. Keep or set `FANVUE_POST_VERIFY_ENABLED=false`.
4. Remove or rotate Fanvue Client Secret if exposed or suspected exposed.
5. Disconnect/revoke the internal Fanvue account.
6. Redeploy the previous known-good commit if needed.
7. Confirm Fanvue remains assisted/manual only.
8. Confirm no Fanvue jobs ran.
9. Confirm no public users had access.
10. Confirm X behavior remains unaffected.

## J. Never-do list

Never:

- Paste Fanvue Client Secret into Codex, chat, GitHub, docs, logs, screenshots, or PR text.
- Turn on dispatch before proof path is complete.
- Treat `SCHEDULED_CREATED` as `POSTED`.
- Treat `POSTED_READY_FOR_PROOF` as persisted proof.
- Treat `workflow_task_id` as `platform_post_id`.
- Treat `ok:true` as proof.
- Use browser-captured/private endpoints.
- Scrape Fanvue.
- Use cookies/session automation as a production posting path.
- Enable public scheduling before strict proof/runbook acceptance.
- Run SQL without backup and final human confirmation.

## K. Commands/checks

Recommended review checks:

```bash
git status --short
git diff --check
npx tsx backend/autopost/tests/fanvueOAuthSourceSafety.test.ts
npx tsx backend/autopost/tests/fanvueDraftContentPayload.test.ts
npx tsx backend/autopost/tests/fanvueAdapterFoundation.test.ts
npx tsx backend/autopost/tests/fanvueProofValidation.test.ts
npx tsx backend/autopost/tests/fanvueScheduleAdvance.test.ts
npx tsc --noEmit
rg -n "public_selectable:\s*true|can_schedule:\s*true|supports_real_posting:\s*true|supports_text_posting:\s*true|supports_media_posting:\s*true|native_posting_available:\s*true" lib app backend .env.example --glob '!node_modules' || true
rg -n "fanvue|validateFanvueScheduleAdvanceProof" app/api/autopost/run/route.ts lib/autopost/scheduleAdvance.ts --glob '!node_modules' || true
rg -n "FANVUE_CLIENT_SECRET=.+|FANVUE_CLIENT_ID=.+|fanvue_secret|real_fanvue|Bearer [A-Za-z0-9_-]{20,}" . --glob '!node_modules' --glob '!*.log' || true
find supabase/migrations -type f | sort | tail -5
```

## FV-40CY public exposure warning

Fanvue remains internal/testing-only. FV-40CY does not approve reconnect, upload, post, dispatch, scheduling, public UI exposure, platform registry changes, launch-facing platform selection, or public platform lists. It does not prove `creatorUserUuid`; `top_level_uuid` remains candidate-only.
