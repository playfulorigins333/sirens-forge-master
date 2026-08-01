# Sirens Forge Agent Operating Rules

These rules apply to the entire repository.

- Verify the actual branch, commit, working tree, files, migrations, deployment, and terminal output before making claims. Distinguish confirmed facts from theories and assumptions; stop and report incomplete evidence rather than guessing.
- Make the smallest safe change, one controlled step at a time. Never modify `main` directly. Use one task branch and one narrowly scoped pull request, and do not mix unrelated changes.
- Never rewrite or delete applied migration history. When database correction is authorized, preserve history and use a forward-only cleanup migration.
- Production changes, database writes, migration application, Stripe actions, environment changes, OAuth actions, and deployment promotions each require separate explicit authorization.
- A successful build does not prove that Production serves that deployment. A Production-target deployment does not prove custom-domain aliases moved. After an authorized deployment, separately verify custom aliases and public responses.
- During a read-only audit, never invoke Checkout, Stripe Connect onboarding, OAuth, posting, payment, subscription, entitlement, or destructive operations.
- Never substitute fake, mock, or placeholder generation output for real generation testing. Generation pods are currently offline. Until they return, limit pre-pod QA to build/deploy checks, static UI, route existence, payload review, schema/RLS review, and non-generation flows; do not claim generation or post-generation validation.
- In any ElevenSparks-related client-facing material, use **“event staff,”** not “guards.” Keep all ElevenSparks work separate from Sirens Forge product work.
- Return the exact changed files, validation results, commit SHA, PR state, and explicit confirmation of actions not performed.
