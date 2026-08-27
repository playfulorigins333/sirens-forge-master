# Salad/Kelpie Trainer execution package (Pass 5A)

This is a **source-only, undeployed** package for a possible future Trainer runtime. The provider-neutral durable worker remains the sole claim, lease, cancellation, spend, dispatch, recovery, and finalization authority. A future adapter may submit a Kelpie job to Salad; this pass does not add that adapter or activate infrastructure.

## Responsibility boundary

The executor reads local inputs and writes local work, checkpoints, and the final artifact. It has no database, Supabase/PostgREST, object-storage SDK, or provider API access. Kelpie—not the executor—owns S3-compatible/R2 synchronization. The example job has placeholders only and is not evidence of deployment.

Dataset Doctor owns export. A future worker must pass `request_payload.dataset_reference.bucket` and `request_payload.dataset_reference.prefix` unchanged to Kelpie. The current namespace is `attempts/<identity_id>/<dataset_doctor_job_id>`; do not reconstruct a legacy `lora_datasets/<id>` fallback. Kelpie syncs that authoritative prefix to `/opt/sirens/input/dataset`.

Private base-model and VAE files are synced at runtime. They are not baked into the image. Their actual lowercase SHA256 values must be supplied and verified before any canary. The executor prepares copies and captions without mutating the synced dataset, lazily loads `Salesforce/blip-image-captioning-base`, then releases BLIP before training.

Checkpoint sync is attempt-isolated at `trainer-checkpoints/<attempt_id>/`. Only an exact `<output_name>-step########-state` directory for that identity and attempt is eligible for resume. The final output directory contains exactly `final.safetensors`, which Kelpie would map to `loras/<identity_id>/final.safetensors`; the existing atomic Trainer finalizer remains responsible for product completion.

## Reproducibility

* Base: `pytorch/pytorch:2.6.0-cuda12.6-cudnn9-runtime@sha256:f894dae26e1ee8557c544f9cfdb9dc011b1552bf3c1e656b422f2e221d380e40`
* sd-scripts: `37a1cbbc5725ed2a3575506e7bd2001c9908ac92`
* Kelpie: `0.7.2`, release commit `525617c6e7188bff95bc55df5e29f194edafefe6`, Linux x64 SHA256 `a0b98e9d44fb4ebbe3b8267e7545616a6814f9b07f9757e00ca84037b73f20f8`
* BLIP: `Salesforce/blip-image-captioning-base`, loaded lazily at runtime
* Direct overlay: `Pillow==11.1.0`

The Docker build installs sd-scripts' upstream `requirements.txt`. That file pins many but not all dependencies (including some transitives), so the immutable sd-scripts source pin does not make every future package-index resolution byte-identical. This package intentionally does not fabricate an upstream lock.

## Local validation

```sh
npm run test:salad-trainer-source
```

Pass 5A creates no Salad resources, policies, registry entry, worker enablement, storage traffic, or live canary. Exact provider cost accounting and real private model/VAE hashes remain mandatory pre-canary gates.
