# Publishing provider disconnect rollout dependency

The application disconnect routes require the database functions introduced by
`20260823090000_publishing_provider_disconnect_truth.sql`.

Production rollout order is mandatory:

1. In a separately authorized database change, apply the migration to Supabase
   Production and verify the RPC definitions and service-role-only grants.
2. Verify disposable/staging disconnect behavior without contacting a provider.
3. Only after the Production RPC is present and verified, deploy the application
   code that calls `disconnect_publishing_provider`.

A normal Vercel deployment does not apply Supabase migrations and must not be
assumed to do so. Deploying the application routes before the RPC exists would
temporarily break disconnect. This repository change does not authorize or
record applying the migration, deploying the application, or mutating Production.
