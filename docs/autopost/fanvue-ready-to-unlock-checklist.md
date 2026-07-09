# Fanvue ready-to-unlock checklist

Date: 2026-07-09

## Completed while blocked

- Provider proof for text/image/video internal Fanvue paths.
- Locks and redaction that keep provider UUIDs, raw provider responses, signed URLs, R2 keys, media bytes, tokens, cookies, headers, and secrets out of public/test results.
- Launch-readiness payload bridge for Fanvue text, image, and video job payloads.
- Mocked runner persistence bridge for dry-run success/failure intent without live dispatch or Supabase mutation.
- Gated `/api/autopost/run` Fanvue dry-run branch requiring both env gate and exact request confirmation.
- Route-level app-shaped Fanvue autopost rule data verification.
- Internal/test-gated scheduled rule creation bridge for text, image, and video app-shaped rows.

## Still intentionally blocked until all required platforms are built

- Public Fanvue UI.
- Public Fanvue platform selection.
- Live Fanvue runner dispatch.
- Scheduler, cron, bulk, and retry behavior for Fanvue.
- Fanvue price, paywall, `publishAt`, and native scheduling support.
