# Legacy scheduler audit before CPQ Fanvue cron activation

## Verified repository state

- `app/api/autopost/run/route.ts` remains present and cron-authenticated. Its runnable dispatch branch is explicitly gated by `AUTOPOST_X_RUN_DISPATCH_ENABLED` and selects only `x`; it has no Fanvue provider, upload, token-decryption, or CPQ worker call.
- The historical `autopost_rules`, `autopost_jobs`, and `autopost_job_logs` schema and legacy planner/runner code remain present. They are not modified by the CPQ activation SQL.
- `vercel.json` configures only the two affiliate payout entries. It configures neither legacy AutoPost nor either CPQ runner route.
- The generic CPQ scheduler route, `/api/creator-publishing-queue/scheduler/run`, remains present but is not configured as a recurring Vercel trigger. It processes CPQ scheduler events; it does not invoke the Fanvue provider worker.
- Historical admin Fanvue diagnostic and controlled-proof routes remain present. They require explicit admin/confirmation gates and are not recurring triggers.
- Repository SQL before this change contained no recurring Fanvue/CPQ HTTP trigger. Production `cron.job` state is external to source control and must be rechecked immediately before separately authorized activation; the supplied production audit evidence reported zero Fanvue/CPQ jobs.

## Conflict conclusion

No repository-configured legacy recurring trigger can currently produce Fanvue execution. The dormant legacy runner can execute gated X work if called with its explicit dispatch controls, but its live branch cannot select Fanvue. It is therefore preserved.

The operator-run activation targets only `/api/creator-publishing-queue/fanvue/run`, the route that advances CPQ scheduler state and invokes the CPQ Fanvue worker. It does not call `/api/autopost/run`, read or mutate legacy AutoPost state, or create another publishing state machine. Before scheduling, it fails if a differently named cron already targets the CPQ Fanvue route; rerunning it replaces only its own named job. `vercel.json` remains unchanged, so it does not duplicate the trigger there.

## Activation boundary

The SQL under `supabase/manual` is intentionally not a migration. Committing it does not apply it, create Vault secrets, change an environment, or activate Production. An authorized operator must first re-audit `cron.job`, configure the two named Vault secrets, apply the activation SQL, and then separately verify the resulting job and public route response. The companion deactivation SQL removes only the named CPQ trigger and leaves legacy structures untouched.
