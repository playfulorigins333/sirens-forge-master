# API authorization inventory — Phase 9 extension

This additive inventory records the dedicated internal transactional-notification scheduler.

**Combined inventory:** 128 route files / 151 route-method entries

| Route path | Source file | Method | Caller class | Authorization class | Authentication mechanism | Ownership boundary | Entitlement boundary | Admin/operator boundary | External signature/secret boundary | Privileged client/service-role usage | Validation/safe-error notes | Reviewed status | Evidence/test reference |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/api/internal/notifications/phase9/run` | `app/api/internal/notifications/phase9/run/route.ts` | `GET` | Scheduled internal notification caller | SCHEDULER_SECRET + INTERNAL_CONTROLLED | Shared `authenticateSchedulerRequest()` validates `CRON_SECRET` or `VERCEL_CRON_SECRET` before config, Supabase, or Resend access | Caller supplies no recipient, owner, source, or notification selector; database sources owner from lifecycle rows and server resolves the matching Auth user | Not entitlement-gated because transactional lifecycle truth, including cancellation/delinquency, is authoritative | No browser or admin surface; scheduled internal control only | Scheduler secret authenticates invocation; Resend API key is server-only and stable notification ID is provider idempotency key | Supabase admin client and Resend are created only after authentication and exact enabled gate; database access is through service-role-only bounded RPCs | No body/query input; fixed maximum batch; safe finite counts/error codes and `no-store`; no recipient or provider body in response/logs | PASS | Phase 9 source, scheduler behavior, injected transport, and PostgreSQL 17 tests |
