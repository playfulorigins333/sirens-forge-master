# Image Model Validation Gate

This offline subsystem validates registered image checkpoints before GPU technical-canary work. It neither downloads models nor calls providers, object storage, generation routes, or Production. It cannot execute explicit/adult generation and cannot grant Production approval.

## Registered candidates

`registry.json` is the fail-closed source of candidate identity, canonical filename, byte count, SHA-256, policy, and evidence references. It currently registers `bigasp-v2` as the primary candidate and `cyberrealistic-xl-v10` as backup. `OPERATOR_EVIDENCE_REQUIRED` deliberately records the missing Cyber creator-controlled Hugging Face evidence; it is not a URL and must not be replaced by invented evidence.

## Operator workflow

1. Obtain the checkpoint through a separately authorized process and preserve it at an absolute local path with its canonical filename. Never put the checkpoint in Git.
2. Run `npm run image-model:validate -- verify bigasp-v2 /absolute/controlled/path/bigasp_v20.safetensors`.
3. Preserve license/source evidence as local files. Review each rights field and encode only substantiated values as `CONFIRMED`; unresolved rights remain `UNKNOWN` and adverse evidence is `REJECTED`.
4. Create an immutable new manifest (the output must not already exist):

   `npm run image-model:validate -- manifest bigasp-v2 /absolute/controlled/path/bigasp_v20.safetensors /absolute/evidence/bigasp-v2-manifest.json 2026-08-22T12:00:00.000Z '{"commercial_outputs":"UNKNOWN","outside_paid_saas":"UNKNOWN","lora_training":"UNKNOWN","cloud_operation":"UNKNOWN","lawful_explicit_nsfw":"UNKNOWN","upstream_chain":"UNKNOWN"}' /absolute/evidence/source-page.pdf`

The verifier streams SHA-256 and tensor data, retaining only the SafeTensor header and a small data chunk in memory. It checks every tensor record and emits deterministic name-sorted JSON containing dtype, shape, NaN, positive-infinity, and negative-infinity counts.

## Failures and states

Filename, byte-size, or hash mismatches identify the wrong artifact. `UNSAFE_CHECKPOINT_FORMAT` rejects non-`.safetensors` formats (including pickle checkpoints). `MALFORMED_SAFETENSOR` means header, tensor metadata, extent, or file content is invalid. `UNSAFE_PATH` rejects relative, traversing, symlinked, or non-regular paths. Failures are JSON and exit non-zero; nothing is renamed, repaired, substituted, or downloaded.

Finite scans can proceed to evidence evaluation. Any `bigasp-v2` non-finite value is `BLOCKED`; any Cyber non-finite value is `REVIEW_REQUIRED`, never a pass. Missing rights/evidence is `EVIDENCE_INCOMPLETE`. Only complete evidence plus a verified finite artifact can become `READY_FOR_TECHNICAL_CANARY`.

`PRODUCTION_APPROVED` is intentionally impossible here. After `READY_FOR_TECHNICAL_CANARY`, an operator must use separately authorized GPU technical-canary, quality, legal/rights, and explicit/adult-generation review gates, followed by an independent Production approval process.
