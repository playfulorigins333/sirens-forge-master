# Sirens Forge Trainer Pod Deployment

This document is the launch checklist for the always-on LoRA trainer pod at `runpod/train_lora.py`. It documents deployment requirements only; it does not change trainer behavior.

## Worker behavior summary

The trainer is an always-on worker. It polls Supabase for one `user_loras` row where `status = queued` and `user_id` is not null, marks that row as `training`, downloads the dataset from Cloudflare R2, runs the SDXL `sd-scripts` LoRA trainer, uploads the final artifact to R2, and patches the `user_loras` row with terminal status and artifact metadata.

## Required environment variables

Use placeholder values in templates and configure real values only in the deployment secret manager or RunPod UI.

### Supabase

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Supabase project URL used for PostgREST polling and updates. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key used as the `apikey` and bearer token for worker-side Supabase REST calls. |
| `LORA_NOTIFY_ENDPOINT` | No | Terminal status notification endpoint. Defaults to `${SUPABASE_URL}/functions/v1/lora-status-notify` when unset. |

### R2 / S3-compatible storage

| Variable | Required | Purpose |
| --- | --- | --- |
| `R2_ENDPOINT` | Yes | Cloudflare R2 S3-compatible endpoint. |
| `R2_ACCESS_KEY_ID` | Yes | R2 access key ID. |
| `R2_SECRET_ACCESS_KEY` | Yes | R2 secret access key. |
| `AWS_DEFAULT_REGION` | Yes | Region value passed to boto3; use `auto` for R2 unless your account requires otherwise. |
| `R2_BUCKET` | Yes as fallback | Shared fallback bucket used when dataset or artifact-specific bucket env vars are unset. |
| `R2_DATASET_BUCKET` | Recommended | Dataset bucket fallback when a queued row does not include `dataset_r2_bucket`. Falls back to `R2_BUCKET`. |
| `R2_DATASET_PREFIX_ROOT` | Recommended | Dataset prefix fallback root. Defaults to `lora_datasets`. |
| `R2_ARTIFACT_BUCKET` | Recommended | Artifact upload bucket. Falls back to `R2_BUCKET`. |
| `R2_ARTIFACT_PREFIX_ROOT` | Recommended | Artifact upload prefix root. Defaults to `loras`. |

### Trainer / model

| Variable | Required | Purpose |
| --- | --- | --- |
| `PRETRAINED_MODEL` | Yes | Absolute path to the base SDXL model file. The worker hard-fails if this path does not exist. |
| `VAE_PATH` | Yes | Absolute path to the VAE file. The worker hard-fails if this path does not exist. |
| `TRAIN_SCRIPT` | Yes | Absolute path to `sd-scripts` `sdxl_train_network.py`. Defaults to `/workspace/sd-scripts/sdxl_train_network.py`. |
| `PYTHON_BIN` | Recommended | Python executable used to launch `TRAIN_SCRIPT`. Defaults to the interpreter running the worker. |
| `LORA_LOCAL_TRAIN_ROOT` | Recommended | Writable local root for per-job datasets. Defaults to `/workspace/train_data`. |
| `LORA_OUTPUT_ROOT` | Recommended | Writable local root for per-job outputs. Defaults to `/workspace/output_loras`. |
| `LORA_NETWORK_MODULE` | Recommended | Network module passed to `sd-scripts`. Defaults to `networks.lora`. |
| `LORA_CONCEPT_TOKEN` | Optional | Legacy fallback concept token. Defaults to `concept`. |
| `LORA_CAPTION_EXTENSION` | Recommended | Caption file extension. Must start with `.` and defaults to `.txt`. |
| `LORA_USE_BLIP_CAPTIONS` | Recommended | `1` enables BLIP captioning; `0` disables it. Defaults to `1`. |
| `LORA_BLIP_MODEL_ID` | Recommended when BLIP is enabled | Hugging Face BLIP model ID. Defaults to `Salesforce/blip-image-captioning-base`. |
| `LORA_TRIGGER_SUFFIX` | Recommended | Human-readable class token appended after the generated trigger token. Defaults to `woman`. |
| `LORA_CAPTION_STYLE_PREFIX` | Optional | Additional short caption bias prefix. Defaults to empty. |

## Required mounted files and writable paths

The pod is not deployable unless these files and paths exist inside the container or attached volume:

| Path | Requirement |
| --- | --- |
| `/workspace/runpod/train_lora.py` | Worker script launched by `runpod/start_pod.json`. |
| `/workspace/sd-scripts/sdxl_train_network.py` | `sd-scripts` SDXL training entrypoint. |
| `/workspace/models/<base-model>.safetensors` | Base model file referenced by `PRETRAINED_MODEL`. |
| `/workspace/models/<vae>.safetensors` | VAE file referenced by `VAE_PATH`. |
| `/workspace/train_data` | Writable local training-data root, or replace with `LORA_LOCAL_TRAIN_ROOT`. |
| `/workspace/output_loras` | Writable local artifact output root, or replace with `LORA_OUTPUT_ROOT`. |

## Required Python/runtime dependencies

The deployment image must provide these runtime dependencies. If you build a custom image, install and verify them before launching the worker.

- Python.
- PyTorch with CUDA support compatible with the selected GPU.
- `boto3` and `botocore` for R2/S3 access.
- `requests` for Supabase REST and notification calls.
- Pillow / `PIL` for image loading.
- `transformers` for BLIP captioning when `LORA_USE_BLIP_CAPTIONS=1`.
- `accelerate`, required by the BLIP/transformers stack and commonly by training setups.
- `sd-scripts` and its dependencies, including the `networks.lora` module expected by `LORA_NETWORK_MODULE`.

Exact install commands are deployment-image-specific. Treat these as required image contents unless a separate Dockerfile or image build process pins exact versions.

## Dataset contract

The trainer only processes queued rows:

- Table: `user_loras`.
- Required row state: `status = queued`.
- Additional filter: `user_id` must not be null.
- Poll order: oldest `created_at` first.

Preferred dataset source comes from the queued `user_loras` row:

- `dataset_r2_bucket`.
- `dataset_r2_prefix`.

If row fields are missing, the fallback source is:

- Bucket: `R2_DATASET_BUCKET`, or `R2_BUCKET` if `R2_DATASET_BUCKET` is unset.
- Prefix: `R2_DATASET_PREFIX_ROOT/<lora_id>/`.

The dataset prefix must contain 10 to 20 image files with supported extensions: `.jpg`, `.jpeg`, `.png`, or `.webp`.

## Artifact contract

After successful training, the worker uploads the final LoRA artifact to R2:

- Bucket: `R2_ARTIFACT_BUCKET`, or `R2_BUCKET` if `R2_ARTIFACT_BUCKET` is unset.
- Key: `R2_ARTIFACT_PREFIX_ROOT/<lora_id>/final.safetensors`.

After upload, the worker writes back to `user_loras`:

- `artifact_r2_bucket`.
- `artifact_r2_key`.
- `status = completed`.
- `progress = 100`.
- `dataset_r2_bucket` and `dataset_r2_prefix` actually used.
- `image_count`.
- `trigger_token` when the column exists; the worker strips unknown columns from Supabase PATCH payloads.

On failure before artifact upload, the worker writes:

- `status = failed`.
- `progress = 0`.
- `error_message`.

## Deployment blockers / prerequisites

Do not launch the trainer pod until all of these are true:

- The model file exists at `PRETRAINED_MODEL`.
- The VAE file exists at `VAE_PATH`.
- The `sd-scripts` trainer exists at `TRAIN_SCRIPT`.
- R2 env vars are present and valid.
- Supabase service role env vars are present and valid.
- Runtime dependencies are installed.
- `LORA_LOCAL_TRAIN_ROOT` is writable.
- `LORA_OUTPUT_ROOT` is writable.
- The container or volume includes `/workspace/runpod/train_lora.py` at the command path used by the pod template.

## Template launch config

`runpod/start_pod.json` is a comment-free JSON template with placeholder values only. Replace placeholders in RunPod or your secret manager. Do not commit real keys, tokens, bucket credentials, private account IDs, or model filenames that should remain private.
