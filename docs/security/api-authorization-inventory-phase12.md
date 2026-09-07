# Phase 12 API authorization inventory

| Route | File | Method | Actor | Authorization | Authentication mechanism | Ownership | Entitlement | Capability | Scheduler | Privileged client | Validation / rate / cache | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/api/admin/billing/financial-events` | `app/api/admin/billing/financial-events/route.ts` | `GET` | Human billing administrator | AUTHENTICATED + FRESH_TOTP + ADMIN | Verified Supabase session, fresh TOTP, and database capability recheck | Session-derived actor only | Not required | `billing.financial.read` | None | Server-only service role invokes bounded audited RPC | Finite kind, timestamp/UUID composite cursor, limit 1–100, no-store, safe finite errors | PASS | Read-only minimized finance evidence; no provider actions or raw payloads |
