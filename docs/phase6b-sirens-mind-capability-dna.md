# Phase 6B: Siren's Mind capability and Character DNA contract

`vault_registry.ts` is the sole Vault identity and mode-gating authority; each canonical ID maps to one nonempty `vaults/<id>.txt`. `macro_registry.ts` truthfully registers only recipes backed by nonempty `macros/<id>.txt` files.

The conversational route composes the base system, conversational governor, a server-loaded current-mode capability catalog, and its dedicated JSON response runtime. SAFE receives SAFE recipes only, NSFW receives SAFE and NSFW recipes, and ULTRA may receive all recipes. Capability prose is creative guidance and cannot override mode, legality, safety, or transport contracts. Creators interact in natural language and never configure capability IDs.

After subscription authorization, the route uses the authenticated `supabaseServer` session and owner-filtered `user_loras` query under RLS. Only bounded completed, artifact-ready identities are represented to the provider as `id`, `name`, and `description` in a delimited user-role data message. Storage and training metadata are excluded. Suggested and model-returned identity IDs are checked against this owned set server-side; Generator retains its independent validation.

Next output tracing explicitly includes prompt text assets for both conversational and headless API functions. There is no persistent chat memory, streaming, admin RP, provider execution, or database migration in this phase. Rollback is limited to this application commit and the canonical filename renames.
