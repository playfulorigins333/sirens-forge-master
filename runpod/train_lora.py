#!/usr/bin/env python3
"""
SirensForge - Always-on LoRA Training Worker (PRODUCTION)
OPTION B — REST DB ONLY + R2 STORAGE (S3-compatible)

✅ sd-scripts compatible dataset structure (SDXL)
✅ Per-job dataset folder: /workspace/train_data/sf_<JOB_ID>/
✅ Hard image gate: 10–20 images
✅ Repeat/steps targeting ~1200 effective samples
✅ SDXL-safe concept enforcement via captions (.txt) NOT --class_tokens
✅ Hard-fail on missing dataset / missing artifact / tiny artifact
✅ Supabase schema-safe PATCH (auto-strips unknown columns)
✅ Cloudflare R2 dataset download + artifact upload
✅ Terminal-status email notify (Edge Function) — ONLY on completed/failed

IMPORTANT:
- This worker does NOT upload artifacts to Supabase Storage.
- Artifacts go to R2 (S3-compatible).
"""

import os
import sys
import time
import json
import shutil
import subprocess
from typing import Dict, Any, List, Tuple, Optional

import requests

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError


# ─────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────
def log(msg: str) -> None:
    print(f"[train_lora_worker] {msg}", flush=True)


def require_env(name: str) -> str:
    v = os.getenv(name)
    if not v:
        raise RuntimeError(f"Missing env: {name}")
    return v


# ─────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────
SUPABASE_URL = require_env("SUPABASE_URL").rstrip("/")
SUPABASE_KEY = require_env("SUPABASE_SERVICE_ROLE_KEY")

PRETRAINED_MODEL = require_env("PRETRAINED_MODEL")
VAE_PATH = require_env("VAE_PATH")

LOCAL_TRAIN_ROOT = os.getenv("LORA_LOCAL_TRAIN_ROOT", "/workspace/train_data")
OUTPUT_ROOT = os.getenv("LORA_OUTPUT_ROOT", "/workspace/output_loras")

TRAIN_SCRIPT = os.getenv("TRAIN_SCRIPT", "/workspace/sd-scripts/sdxl_train_network.py")
PYTHON_BIN = os.getenv("PYTHON_BIN", sys.executable)

NETWORK_MODULE = os.getenv("LORA_NETWORK_MODULE", "networks.lora")

POLL_SECONDS = 5
IDLE_LOG_SECONDS = 30

MIN_IMAGES = 10
MAX_IMAGES = 20
TARGET_SAMPLES = 1200

CONCEPT_TOKEN = os.getenv("LORA_CONCEPT_TOKEN", "concept")
CAPTION_EXTENSION = os.getenv("LORA_CAPTION_EXTENSION", ".txt")

ARTIFACT_MIN_BYTES = 2 * 1024 * 1024  # 2MB

# Edge Function notify (terminal states only)
LORA_NOTIFY_ENDPOINT = os.getenv(
    "LORA_NOTIFY_ENDPOINT",
    f"{SUPABASE_URL}/functions/v1/lora-status-notify",
).rstrip("/")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")


# ─────────────────────────────────────────────────────────────
# R2 Config (S3 compatible)
# ─────────────────────────────────────────────────────────────
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_ENDPOINT = os.getenv("R2_ENDPOINT")  # https://<accountid>.r2.cloudflarestorage.com
AWS_DEFAULT_REGION = os.getenv("AWS_DEFAULT_REGION", "auto")

R2_BUCKET = os.getenv("R2_BUCKET")

R2_DATASET_BUCKET = os.getenv("R2_DATASET_BUCKET", R2_BUCKET)
R2_ARTIFACT_BUCKET = os.getenv("R2_ARTIFACT_BUCKET", R2_BUCKET)

R2_DATASET_PREFIX_ROOT = os.getenv("R2_DATASET_PREFIX_ROOT", "lora_datasets")
R2_ARTIFACT_PREFIX_ROOT = os.getenv("R2_ARTIFACT_PREFIX_ROOT", "loras")


def _clean_prefix(p: str) -> str:
    p = (p or "").strip()
    while p.startswith("/"):
        p = p[1:]
    while p.endswith("/"):
        p = p[:-1]
    return p


R2_DATASET_PREFIX_ROOT = _clean_prefix(R2_DATASET_PREFIX_ROOT)
R2_ARTIFACT_PREFIX_ROOT = _clean_prefix(R2_ARTIFACT_PREFIX_ROOT)


def r2_enabled() -> bool:
    return bool(
        R2_ACCESS_KEY_ID
        and R2_SECRET_ACCESS_KEY
        and R2_ENDPOINT
        and R2_DATASET_BUCKET
        and R2_ARTIFACT_BUCKET
    )


def make_r2_client():
    if not r2_enabled():
        raise RuntimeError(
            "R2 env missing. Required: "
            "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET "
            "(or explicit R2_DATASET_BUCKET / R2_ARTIFACT_BUCKET)."
        )

    session = boto3.session.Session()
    cfg = BotoConfig(
        region_name=AWS_DEFAULT_REGION,
        retries={"max_attempts": 10, "mode": "standard"},
        signature_version="s3v4",
    )

    return session.client(
        "s3",
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        endpoint_url=R2_ENDPOINT,
        config=cfg,
    )


# ─────────────────────────────────────────────────────────────
# Sanity checks
# ─────────────────────────────────────────────────────────────
def sanity_checks() -> None:
    for p, name in [
        (PRETRAINED_MODEL, "PRETRAINED_MODEL"),
        (VAE_PATH, "VAE_PATH"),
        (TRAIN_SCRIPT, "TRAIN_SCRIPT"),
    ]:
        if not os.path.exists(p):
            raise RuntimeError(f"{name} not found: {p}")

    if not CAPTION_EXTENSION.startswith("."):
        raise RuntimeError("LORA_CAPTION_EXTENSION must start with '.'")

    if not r2_enabled():
        raise RuntimeError("R2 is not configured. Confirm env vars exist and survived restart.")


# ─────────────────────────────────────────────────────────────
# Supabase helpers
# ─────────────────────────────────────────────────────────────
def sb_get(table: str, params: Dict[str, Any]):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=HEADERS,
        params=params,
        timeout=20,
    )
    r.raise_for_status()
    return r.json() if r.text else None


def _extract_missing_column(postgrest_text: str) -> Optional[str]:
    try:
        j = json.loads(postgrest_text)
        if isinstance(j, dict):
            msg = (j.get("message") or "")
        else:
            msg = ""
        if "Could not find the '" in msg and "' column" in msg:
            return msg.split("Could not find the '")[1].split("'")[0]
        if "does not exist" in msg and "column" in msg and '"' in msg:
            parts = msg.split('"')
            if len(parts) >= 2:
                return parts[1]
    except Exception:
        pass
    return None


def sb_patch_safe(table: str, payload: Dict[str, Any], params: Dict[str, Any]):
    working = dict(payload)
    for _ in range(8):
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=HEADERS,
            json=working,
            params=params,
            timeout=20,
        )

        if 200 <= r.status_code < 300:
            return r.json() if r.text else None

        if r.status_code != 400:
            r.raise_for_status()

        missing = _extract_missing_column(r.text)
        if missing:
            log(f"⚠️ Supabase missing column '{missing}' — stripping")
            working.pop(missing, None)
            continue

        r.raise_for_status()

    raise RuntimeError("Supabase PATCH failed repeatedly (unknown 400 cause)")


# ─────────────────────────────────────────────────────────────
# Edge Function notify (terminal status only)
# ─────────────────────────────────────────────────────────────
def notify_status(job_id: str, new_status: str) -> None:
    if not LORA_NOTIFY_ENDPOINT:
        log("⚠️ LORA_NOTIFY_ENDPOINT not set — skipping notify")
        return

    payload = {"lora_id": job_id, "new_status": new_status}
    headers = {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json",
    }

    try:
        r = requests.post(LORA_NOTIFY_ENDPOINT, headers=headers, json=payload, timeout=15)
        r.raise_for_status()
        log(f"📨 Notified Edge Function: status={new_status} job={job_id}")
    except Exception as e:
        log(f"⚠️ Notify failed (non-fatal): {e}")


# ─────────────────────────────────────────────────────────────
# R2 helpers (dataset download)
# ─────────────────────────────────────────────────────────────
def r2_list_objects(s3, bucket: str, prefix: str) -> List[str]:
    keys: List[str] = []
    continuation: Optional[str] = None

    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix}
        if continuation:
            kwargs["ContinuationToken"] = continuation

        resp = s3.list_objects_v2(**kwargs)
        for obj in resp.get("Contents", []):
            k = obj.get("Key")
            if k:
                keys.append(k)

        if resp.get("IsTruncated"):
            continuation = resp.get("NextContinuationToken")
            continue
        break

    return keys


def r2_download_file(s3, bucket: str, key: str, local_path: str) -> None:
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    try:
        s3.download_file(bucket, key, local_path)
    except ClientError as e:
        raise RuntimeError(f"R2 download failed: s3://{bucket}/{key} -> {local_path} ({e})")


# ─────────────────────────────────────────────────────────────
# R2 helpers (artifact upload)
# ─────────────────────────────────────────────────────────────
def r2_upload_artifact(s3, local_path: str, bucket: str, key: str) -> str:
    if not os.path.exists(local_path):
        raise RuntimeError(f"Artifact not found for upload: {local_path}")
    size = os.path.getsize(local_path)
    if size < ARTIFACT_MIN_BYTES:
        raise RuntimeError(f"Artifact too small for upload: {size} bytes")

    log(f"☁️ Uploading final LoRA to R2: s3://{bucket}/{key} ({size} bytes)")
    try:
        s3.upload_file(local_path, bucket, key)
    except ClientError as e:
        raise RuntimeError(f"R2 upload failed: s3://{bucket}/{key} ({e})")

    log("☁️ R2 upload complete")
    return key


# ─────────────────────────────────────────────────────────────
# Repeat logic
# ─────────────────────────────────────────────────────────────
def compute_repeat(image_count: int) -> Tuple[int, int]:
    repeat = max(1, round(TARGET_SAMPLES / image_count))
    return repeat, image_count * repeat


# ─────────────────────────────────────────────────────────────
# Dataset builder
# ─────────────────────────────────────────────────────────────
def _write_caption_for_image(image_path: str) -> None:
    root, _ = os.path.splitext(image_path)
    with open(root + CAPTION_EXTENSION, "w", encoding="utf-8") as f:
        f.write(CONCEPT_TOKEN)


def prepare_dataset(job_id: str) -> Dict[str, Any]:
    s3 = make_r2_client()

    base = os.path.join(LOCAL_TRAIN_ROOT, f"sf_{job_id}")
    shutil.rmtree(base, ignore_errors=True)
    os.makedirs(base, exist_ok=True)

    prefix = f"{R2_DATASET_PREFIX_ROOT}/{job_id}".replace("//", "/")
    keys = r2_list_objects(s3, R2_DATASET_BUCKET, prefix)
    if not keys:
        raise RuntimeError(f"No files found in R2 for this job: s3://{R2_DATASET_BUCKET}/{prefix}")

    tmp = os.path.join(base, "_tmp")
    os.makedirs(tmp, exist_ok=True)

    for key in keys:
        filename = os.path.basename(key)
        if not filename:
            continue
        local_path = os.path.join(tmp, filename)
        r2_download_file(s3, R2_DATASET_BUCKET, key, local_path)

    images = [f for f in os.listdir(tmp) if f.lower().endswith(IMAGE_EXTS)]
    count = len(images)

    if not (MIN_IMAGES <= count <= MAX_IMAGES):
        raise RuntimeError(f"Invalid image count: {count} (expected {MIN_IMAGES}-{MAX_IMAGES})")

    repeat, effective = compute_repeat(count)
    concept_dir = os.path.join(base, f"{repeat}_{CONCEPT_TOKEN}")
    os.makedirs(concept_dir, exist_ok=True)

    for img in images:
        src = os.path.join(tmp, img)
        dst = os.path.join(concept_dir, img)
        shutil.move(src, dst)
        _write_caption_for_image(dst)

    shutil.rmtree(tmp, ignore_errors=True)

    log(f"📦 R2 dataset: bucket={R2_DATASET_BUCKET} prefix={prefix} files={len(keys)}")
    log(f"📊 Images={count} → repeat={repeat} → samples≈{effective}")
    log(f"🧾 Captions: {CAPTION_EXTENSION} = '{CONCEPT_TOKEN}'")

    return {
        "base_dir": base,
        "steps": effective,
        "image_count": count,
        "repeat": repeat,
        "r2_prefix": prefix,
    }


# ─────────────────────────────────────────────────────────────
# Training
# ─────────────────────────────────────────────────────────────
def run_training(job_id: str, ds: Dict[str, Any]) -> str:
    out = os.path.join(OUTPUT_ROOT, f"sf_{job_id}")
    os.makedirs(out, exist_ok=True)

    name = f"sf_{job_id}"
    artifact = os.path.join(out, f"{name}.safetensors")

    cmd = [
        PYTHON_BIN,
        TRAIN_SCRIPT,
        "--pretrained_model_name_or_path",
        PRETRAINED_MODEL,
        "--vae",
        VAE_PATH,
        "--train_data_dir",
        ds["base_dir"],
        "--caption_extension",
        CAPTION_EXTENSION,
        "--output_dir",
        out,
        "--output_name",
        name,
        "--network_module",
        NETWORK_MODULE,
        "--resolution",
        "1024,1024",
        "--enable_bucket",
        "--min_bucket_reso",
        "512",
        "--max_bucket_reso",
        "1024",
        "--bucket_reso_steps",
        "64",
        "--train_batch_size",
        "1",
        "--learning_rate",
        "1e-4",
        "--max_train_steps",
        str(ds["steps"]),
        "--network_dim",
        "64",
        "--network_alpha",
        "32",
        "--mixed_precision",
        "fp16",
        "--gradient_checkpointing",
        "--save_model_as",
        "safetensors",
        "--save_every_n_steps",
        "200",
    ]

    log("🔥 Starting training")
    log("CMD: " + " ".join(cmd))

    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if not p.stdout:
        raise RuntimeError("Training process failed to start")

    for line in p.stdout:
        print(line, end="")

    if p.wait() != 0:
        raise RuntimeError("Training failed")

    if not os.path.exists(artifact) or os.path.getsize(artifact) < ARTIFACT_MIN_BYTES:
        raise RuntimeError("Invalid artifact produced")

    log(f"✅ Artifact created: {artifact}")
    return artifact


# ─────────────────────────────────────────────────────────────
# Worker loop
# ─────────────────────────────────────────────────────────────
def worker_main() -> None:
    sanity_checks()

    log("🚀 LoRA worker started (PRODUCTION) — R2 ONLY")
    log(f"NETWORK_MODULE={NETWORK_MODULE}")
    log(f"CONCEPT_TOKEN={CONCEPT_TOKEN}  CAPTION_EXTENSION={CAPTION_EXTENSION}")
    log(f"R2_ENDPOINT={R2_ENDPOINT}")
    log(f"R2_DATASET_BUCKET={R2_DATASET_BUCKET}  R2_DATASET_PREFIX_ROOT={R2_DATASET_PREFIX_ROOT}")
    log(f"R2_ARTIFACT_BUCKET={R2_ARTIFACT_BUCKET}  R2_ARTIFACT_PREFIX_ROOT={R2_ARTIFACT_PREFIX_ROOT}")
    log(f"LORA_NOTIFY_ENDPOINT={LORA_NOTIFY_ENDPOINT}")

    last_idle = 0.0

    while True:
        job_id: Optional[str] = None
        try:
            jobs = sb_get("user_loras", {"status": "eq.queued", "order": "created_at.asc", "limit": 1})

            if not jobs:
                if time.time() - last_idle >= IDLE_LOG_SECONDS:
                    log("⏳ No queued jobs — waiting")
                    last_idle = time.time()
                time.sleep(POLL_SECONDS)
                continue

            job_id = jobs[0]["id"]
            log(f"📥 Found job {job_id}")

            sb_patch_safe("user_loras", {"status": "training", "progress": 1}, {"id": f"eq.{job_id}"})

            ds = prepare_dataset(job_id)
            local_artifact = run_training(job_id, ds)

            s3 = make_r2_client()
            r2_key = f"{R2_ARTIFACT_PREFIX_ROOT}/{job_id}/final.safetensors".replace("//", "/")
            r2_upload_artifact(s3, local_artifact, R2_ARTIFACT_BUCKET, r2_key)

            sb_patch_safe(
                "user_loras",
                {
                    "status": "completed",
                    "progress": 100,
                    "artifact_r2_bucket": R2_ARTIFACT_BUCKET,
                    "artifact_r2_key": r2_key,
                    "artifact_local_path": local_artifact,
                    "dataset_r2_bucket": R2_DATASET_BUCKET,
                    "dataset_r2_prefix": ds.get("r2_prefix"),
                    "image_count": ds.get("image_count"),
                },
                {"id": f"eq.{job_id}"},
            )

            notify_status(job_id, "completed")
            log(f"✅ Completed job {job_id}")

        except Exception as e:
            try:
                if job_id:
                    sb_patch_safe(
                        "user_loras",
                        {"status": "failed", "progress": 0, "error_message": str(e)},
                        {"id": f"eq.{job_id}"},
                    )
                    notify_status(job_id, "failed")
            except Exception as pe:
                log(f"⚠️ Failed to patch failure status: {pe}")

            log(f"❌ Job failed: {e}")
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    worker_main()
