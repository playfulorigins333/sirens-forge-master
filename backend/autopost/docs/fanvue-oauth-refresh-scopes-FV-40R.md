# FV-40R Fanvue OAuth refresh-token scope allowlist

Date: 2026-07-01

## Scope and safety

FV-40R updates only the local Fanvue OAuth approved/default scope list, source-safety tests, and this documentation note. It does not initiate Fanvue reconnect, generate or use an OAuth code, call Fanvue APIs, call the Fanvue token endpoint, verify identity live, run live upload, call `/posts`, modify Vercel env vars, modify local env files, run SQL, create migrations, or write Supabase data.

## Scope change

FV-40Q documented that public Fanvue OAuth docs indicate refresh-token issuance is scope-based: `offline_access` provides refresh tokens, and Fanvue default scopes include `openid`, `offline_access`, and `offline`.

FV-40R therefore adds these official refresh/offline scopes to the repo-approved/default Fanvue OAuth scope allowlist:

- `openid`
- `offline_access`
- `offline`

The existing media scope posture is preserved:

- `read:media` remains present.
- `write:media` remains present.
- `write:creator` remains absent.

## Authorize URL behavior

`buildFanvueAuthorizeUrl` continues to build the OAuth authorize URL through the existing `scope=<approved scopes joined by spaces>` mechanism. With FV-40R, a future manual reconnect can request the newly approved refresh/offline scopes in that `scope` parameter.

FV-40R does not add Google-style `prompt=consent` or `access_type=offline` query parameters because FV-40Q found current public Fanvue evidence points to refresh-token scopes, especially `offline_access`, rather than those query parameters.

## Remaining proof required

This change only makes the future OAuth request capable of asking for the official refresh-token scopes. It does not prove that Fanvue will return a `refresh_token` for the app or connected account.

A separate manual reconnect and safe post-reconnect preflight are still required before any live upload retry. FV-40R does not approve live upload.
