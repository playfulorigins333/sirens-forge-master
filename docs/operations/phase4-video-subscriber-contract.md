# Phase 4 Video subscriber contract

Phase 4 provides one durable provider-neutral Video Project per Generate click. It supports Text → Video (required prompt) and Image → Video (optional prompt), negative prompts, body presentation, and an optional completed owned AI Twin. Image sources are either owned private generated images or JPEG/PNG/WebP uploads (maximum 50 MiB) promoted from a random staging key into canonical private storage.

STANDARD permits 10–15 seconds, motion 0.40–0.80 (default 0.65), and two segments. OG permits 20–25 seconds, motion 0.60–1.00 (default 0.80), and three segments. Every project targets 30 FPS and a final short edge of at least 1080 pixels. Stitch waits for the exact project's segments and produces one private MP4. Playback and download use short-lived owner-authorized URLs. Saved project UUIDs support reload recovery, truthful status, cancellation, and completed-result hydration.

Submission is fail-closed unless `VIDEO_GENERATION_ENABLED=true`, `DURABLE_COMPUTE_JOBS_ENABLED=true`, and private creator-media delivery is ready. This application does not select a provider, model, checkpoint, worker, scheduler policy, or spend policy and never falls back to legacy generation.

## Canary boundary

The following remain **UNVERIFIED until final Salad/provider canaries**:

- identity fidelity
- visual/motion quality
- provider latency
- actual GPU cost
- provider cancellation effectiveness
- real provider failure recovery

Marketing must not exceed canary-verified behavior.

Uploaded-source readiness additionally requires the server-only `VIDEO_SOURCE_UPLOAD_INFRA_READY=true` latch after the private bucket's browser PUT CORS, credential scopes, and staging lifecycle have been manually verified. Credentials alone never report upload readiness.

## Separate API repository follow-up

The later API Phase 4 change must accept the exact MASTER Video manifest keys `project_id`, `mode`, `segment_count`, `requested_duration_seconds`, `target_fps`, `target_min_short_edge`, `prompt`, `negative_prompt`, `body_type`, `motion_strength`, `identity_id`, `identity_reference`, and `source`. `identity_id` and `identity_reference` are nullable together. For Image → Video, `source` is the database-resolved private `{bucket, object_key, mime_type, size_bytes, sha256}` authority; for Text → Video it is null. The workload finalization contract remains unchanged where applicable, and the API provider registry must remain empty until the later provider gate.
