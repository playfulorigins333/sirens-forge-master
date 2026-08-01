# Sirens Forge Current State

**State:** Recovered Production-only application baseline; generation compute offline.

**As of:** 2026-08-01

**Verified main and Production commit:** `7522c54e83c02b0fff15b7ab57364f711cb1bf67`

## Snapshot

- **Verified in Production — deployment:** The recorded current main/Production commit is the PR #195 merge commit above, following Checkout recovery PR #194. This does not by itself prove any external transaction or every route.
- **Unknown / requires verification — public domains:** Repository code references `sirensforge.vip`, but the current apex/`www` alias assignments, DNS, TLS, and public responses were not independently queried by this documentation task. Do not convert repository references into a claim that aliases moved.
- **Verified in Production — application baseline:** The application uses the authenticated pre-incident Checkout baseline restored in PR #194, with server-authenticated Stripe Connect protection restored in PR #195.
- **Verified in Production — database migrations:** Applied Checkout incident migrations 02100–02600 were preserved. Forward cleanup migration `20260731002700_remove_checkout_incident_objects.sql` was applied exactly once after the recorded final read-only audit and separate authorization. A future audit should still compare the complete remote migration ledger and schema with the repository.
- **Verified in Production — Checkout:** Guest/pay-first incident objects are removed and current Checkout requires a server-authenticated user. **Unknown / requires verification:** the recovered contract has not been established here as a current end-to-end paid Checkout/webhook/entitlement test.
- **Verified in Production — Stripe Connect security:** PR #195 restores server-authenticated identity, identity-scoped profile lookup/update, delayed privileged-client construction, and sanitized provider errors. **Unknown / requires verification:** no live Connect onboarding was executed as part of that restoration.
- **Offline — generation pods:** Real image/video generation and identity-training compute are not operational. Post-generation flows have not been validated while pods are offline. Static UI/routes/workflow payloads are not substitutes for real output.
- **Implemented but not live-tested — public policy/contact:** Contact and policy pages exist in code. The proxy explicitly allows only a subset anonymously; accessibility and public responses for the full set require verification.
- **Present but inactive — Reddit:** Reddit remains a truthful manual-only placeholder and has a lockdown source-contract test. OAuth/autopost must not be implied.
- **Unknown / requires verification — Autopost:** Provider-specific implementation exists, but configuration, approvals, scopes, gates, credentials, connected-account health, and live posting status must be verified independently. The last repository operations record describes creator-publishing recurring scheduling as disabled.

## Not live-tested by this baseline record

- A paid current-contract Checkout through verified webhook delivery, entitlement grant, billing lifecycle, and reconciliation.
- Stripe Connect account creation/onboarding or a real affiliate destination transfer after PR #195.
- Any generation, training, video, persisted real asset, or post-generation workflow while pods are offline.
- Every policy/contact route through every custom domain.
- Every OAuth, refresh, posting, scheduling, operator, and provider-specific publishing path.

## Current known risks

- Route/build/deployment evidence can be mistaken for end-to-end or custom-domain proof.
- API paths bypass the proxy’s page gate and depend on correct route-local authentication/authorization.
- Payment and entitlement behavior spans Stripe, webhooks, Supabase, capacity UI, and reconciliation; redesign without a staged contract could repeat the incident.
- Repository schema/history may drift from remote migration, RLS, cron, or environment state unless checked read-only.
- Provider integrations have unequal maturity; generic “Autopost supported” language can overstate them.
- Generation UI and routes remain visible in a codebase whose compute is offline.
- Existing policy pages and the proxy public allowlist do not fully align.

## Immediate engineering priorities

1. Maintain the recovered stable baseline.
2. Finish and maintain repository-native documentation.
3. Conduct a read-only architecture audit before redesigning Checkout.
4. Design the future payment-first flow from a clean contract before writing code.
5. Review entitlement, webhook, idempotency, claim, expiration, and reconciliation requirements.
6. Restore generation infrastructure separately when compute is available.
7. Do not mix generation restoration with Checkout redesign.
8. Keep social integrations provider-specific and separately authorized.

## Do not assume

- Do not assume generation or post-generation behavior works because routes and UI exist.
- Do not assume Checkout was end-to-end tested because the authenticated contract was restored.
- Do not assume Connect onboarding ran because its route is protected.
- Do not assume a green build or Production-target deployment is served by a custom domain.
- Do not assume all policy pages are public merely because page files exist.
- Do not assume repository migrations equal remote state, or that a scheduled-job implementation means cron is active.
- Do not assume one provider’s OAuth/posting evidence applies to another provider.
