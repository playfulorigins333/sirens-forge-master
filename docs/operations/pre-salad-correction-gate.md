# PRE-SALAD correction gate

This document is an authoritative sequencing guard. Provider-neutral source and architecture may be built before the gate; provider-specific execution may not.

1. Phase 2 — Trainer + Dataset Doctor
2. Phase 3 — Image application
3. Phase 4 — Video + Stitch application
4. Phase 5 — Queue / priority / recovery / spend behavior
5. Phase 6 — Siren's Mind
6. Phase 7 — Library / private storage / export / deletion
7. Phase 8 — Retention / legal holds / audit / consent
8. Phase 9 — Notifications
9. Phase 10 — Admin / support / security / 2FA
10. Phase 11 — Legal / privacy / AUP / safety / age / NCII / IP
11. Phase 12 — Billing / Stripe / entitlements / disputes
12. Phase 13 — Publishing
13. Phase 14 — Database / API / Railway / Vercel hardening
14. Phase 15 — Full non-provider regression/correction audit
15. **FINAL PRE-SALAD GATE**

**Only after that:** provider/legal recheck, Trainer GPU canary, Image canary, Video benchmarks, cost measurement, and closed beta.

Existing durable-compute plumbing does not advance this order. Until the final gate, no Salad/Kelpie integration, provider adapter, provider-specific container, GPU/model/checkpoint canary, or worker activation is allowed. The old RunPod implementation and variables remain untouched until a replacement is proven. Production scheduler, spend, durable-compute, and runtime gates remain controlled/off until separately authorized.
