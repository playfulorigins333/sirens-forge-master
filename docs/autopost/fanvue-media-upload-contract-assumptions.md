# FV-40I — Fanvue media upload contract assumptions

This note is non-runtime documentation for the mocked Fanvue media upload scaffold. It does not approve a live upload attempt and does not claim Fanvue accepts the current request shape.

## Current mocked upload-session scaffold

The current mocked upload-session code path assumes:

- `POST /media/uploads`
- JSON body `{ name, filename, mediaType }`
- no creator, account, channel, profile, or provider-account context in the path, request body, or headers
- no MIME type field
- no file-size field
- no purpose field
- no checksum field
- `X-Fanvue-API-Version` as the only versioning mechanism
- no `Accept` header
- no proven `write:creator` requirement

These are unverified scaffold assumptions unless an official Fanvue upload contract is added to the repo.

## API base behavior

The admin upload planner currently resolves its API base from `FANVUE_API_BASE_URL`, then `FANVUE_API_BASE`, then `"https://api.fanvue.com"`.

That fallback behavior is an unsafe/unverified live-upload assumption and must not be used as approval evidence for another live upload attempt. Before any future live attempt, a separate gate should either prove the official upload base URL from Fanvue documentation/contract material or harden the planner so live-capable upload planning requires explicit `FANVUE_API_BASE_URL`.

## Scope note

Current repository code does not require `write:creator` for the upload-only scaffold. Do not add `write:creator` to default scopes unless an official Fanvue contract in the repo proves it is required.

## FV-40AH signed-part URL response shape

The signed-part URL parser now treats the connected-user upload-only route as a signed-URL-specific response instead of a generic JSON endpoint. It supports a non-empty `text/plain` string URI response for `GET /media/uploads/{uploadId}/parts/{partNumber}/url`, while retaining mocked JSON string compatibility for local tests.

Unsupported JSON object/envelope shapes, empty bodies, malformed URL strings, and non-2xx responses must fail with safe diagnostics only. Failures must not expose signed URLs, raw provider response bodies, authorization headers, bearer tokens, cookies, OAuth codes, token values, or other secrets.

The indexed creator-scoped documentation for `GET /creators/{creatorUserUuid}/media/uploads/{uploadId}/parts/{partNumber}/url` is not approval to switch the connected-user upload-only path to `/creators`. The upload-only route guard must continue to block `/creators` and `/posts` routes. FV-40AH is code/test hardening only and does not approve a live upload retry.
