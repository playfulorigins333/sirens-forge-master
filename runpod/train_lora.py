#!/usr/bin/env python3
"""
SirensForge - Always-on LoRA Training Worker (PRODUCTION)
OPTION B — STORAGE HANDOFF (REST ONLY)

✅ sd-scripts compatible dataset structure (SDXL)
✅ Per-job dataset folder: /workspace/train_data/sf_<JOB_ID>/
✅ Hard image gate: 10–20 images
✅ Repeat/steps targeting ~1200 effective samples
✅ SDXL-safe concept enforcement via captions (.txt) NOT --class_tokens
✅ Hard-fail on missing dataset / missing artifact / tiny artifact
✅ Supabase schema-safe PATCH (auto-strips unknown columns)
✅ Upload final merged LoRA to Supabase Storage (Build A)
✅ Terminal-status email notify (Edge Function) — ONLY on completed/failed
"""

import os
import sys
import time
import json
import shutil
import subprocess
from typing import Dict, Any, List, Tuple, Optional

import requests


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

# Dataset storage (incoming images)
STORAGE_BUCKET = os.getenv("LORA_DATASET_BUCKET", "lora-datasets")
STORAGE_PREFIX = os.getenv("LORA_DATASET_PREFIX_ROOT", "lora_datasets")

# Artifact storage (final LoRAs)
ARTIFACT_BUCKET = os.getenv("LORA_ARTIFACT_BUCKET", "lora-artifacts")
ARTIFACT_PREFIX = os.getenv("LORA_ARTIFACT_PREFIX_ROOT", "loras")

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
# You can set LORA_NOTIFY_ENDPOINT explicitly, otherwise we build from SUPABASE_URL.
# Example: https://<project>.supabase.co/functions/v1/lora-status-notify
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


def sb_patch_safe(table: str, payload: Dict[str, Any], params: Dict[str, Any]):
    working = dict(payload)
    for _ in range(6):
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

        try:
            msg = json.loads(r.text).get("message", "")
            if "Could not find the '" in msg:
                col = msg.split("Could not find the '")[1].split("'")[0]
                log(f"⚠️ Supabase missing column '{col}' — stripping")
                working.pop(col, None)
                continue
        except Exception:
            pass

        r.raise_for_status()

    raise RuntimeError("Supabase PATCH failed repeatedly")


# ─────────────────────────────────────────────────────────────
# Edge Function notify (terminal status only)
# ─────────────────────────────────────────────────────────────
def notify_status(job_id: str, new_status: str) -> None:
    """
    Notify via Supabase Edge Function.
    IMPORTANT: Call ONLY on terminal states (completed/failed) to avoid spam.
    """
    if not LORA_NOTIFY_ENDPOINT:
        log("⚠️ LORA_NOTIFY_ENDPOINT not set — skipping notify")
        return

    payload = {
        "lora_id": job_id,
        "new_status": new_status,
    }

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
        # Never fail the worker because email notify failed
        log(f"⚠️ Notify failed (non-fatal): {e}")


# ─────────────────────────────────────────────────────────────
# Storage helpers (dataset)
# ─────────────────────────────────────────────────────────────
def list_storage_objects(prefix: str) -> List[Dict[str, Any]]:
    r = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/list/{STORAGE_BUCKET}",
        headers=HEADERS,
        json={"prefix": prefix},
        timeout=20,
    )
    r.raise_for_status()
    return r.json()


def signed_download_url(path: str) -> str:
    r = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/sign/{STORAGE_BUCKET}/{path}",
        headers=HEADERS,
        json={"expiresIn": 3600},
        timeout=20,
    )
    r.raise_for_status()
    signed = r.json()["signedURL"]
    return f"{SUPABASE_URL}/storage/v1{signed}" if signed.startswith("/") else signed


# ─────────────────────────────────────────────────────────────
# Storage helpers (artifact upload)  ✅ Build A
# ─────────────────────────────────────────────────────────────
def upload_artifact_to_storage(local_path: str, job_id: str) -> str:
    """
    Upload ONLY the final merged LoRA to Supabase Storage.
    Returns the storage path (not a signed URL).
    """
    if not os.path.exists(local_path):
        raise RuntimeError(f"Artifact not found for upload: {local_path}")
    size = os.path.getsize(local_path)
    if size < ARTIFACT_MIN_BYTES:
        raise RuntimeError(f"Artifact too small for upload: {size} bytes")

    storage_path = f"{ARTIFACT_PREFIX}/{job_id}/final.safetensors".replace("//", "/")
    url = f"{SUPABASE_URL}/storage/v1/object/{ARTIFACT_BUCKET}/{storage_path}"

    # Supabase Storage upload headers (service role)
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/octet-stream",
        # allow overwrite if re-run
        "x-upsert": "true",
    }

    log(
        f"☁️ Uploading final LoRA to Storage: bucket={ARTIFACT_BUCKET} path={storage_path} ({size} bytes)"
    )
    with open(local_path, "rb") as f:
        r = requests.put(url, headers=headers, data=f, timeout=600)
    r.raise_for_status()

    log("☁️ Upload complete")
    return storage_path


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
    base = os.path.join(LOCAL_TRAIN_ROOT, f"sf_{job_id}")
    shutil.rmtree(base, ignore_errors=True)
    os.makedirs(base, exist_ok=True)

    prefix = f"{STORAGE_PREFIX}/{job_id}"
    objects = list_storage_objects(prefix)
    names = [o.get("name") for o in objects if o.get("name")]

    if not names:
        raise RuntimeError("No files found in storage for this job")

    tmp = os.path.join(base, "_tmp")
    os.makedirs(tmp, exist_ok=True)

    for name in names:
        local = os.path.basename(name)
        url = signed_download_url(f"{prefix}/{name}".replace("//", "/"))
        r = requests.get(url, timeout=180)
        r.raise_for_status()
        with open(os.path.join(tmp, local), "wb") as f:
            f.write(r.content)

    images = [f for f in os.listdir(tmp) if f.lower().endswith(IMAGE_EXTS)]
    count = len(images)

    if not (MIN_IMAGES <= count <= MAX_IMAGES):
        raise RuntimeError(f"Invalid image count: {count}")

    repeat, effective = compute_repeat(count)
    concept_dir = os.path.join(base, f"{repeat}_{CONCEPT_TOKEN}")
    os.makedirs(concept_dir, exist_ok=True)

    for img in images:
        src = os.path.join(tmp, img)
        dst = os.path.join(concept_dir, img)
        shutil.move(src, dst)
        _write_caption_for_image(dst)

    shutil.rmtree(tmp, ignore_errors=True)

    log(f"📊 Images={count} → repeat={repeat} → samples≈{effective}")
    log(f"🧾 Captions: {CAPTION_EXTENSION} = '{CONCEPT_TOKEN}'")

    return {"base_dir": base, "steps": effective}


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
        # ✅ Memory stability (already proven)
        "--gradient_checkpointing",
        "--save_model_as",
        "safetensors",
        "--save_every_n_steps",
        "200",
    ]

    log("🔥 Starting training")
    log("CMD: " + " ".join(cmd))

    p = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
    )
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
    log("🚀 LoRA worker started (PRODUCTION)")
    log(f"NETWORK_MODULE={NETWORK_MODULE}")
    log(f"CONCEPT_TOKEN={CONCEPT_TOKEN}  CAPTION_EXTENSION={CAPTION_EXTENSION}")
    log(f"ARTIFACT_BUCKET={ARTIFACT_BUCKET}  ARTIFACT_PREFIX={ARTIFACT_PREFIX}")
    log(f"LORA_NOTIFY_ENDPOINT={LORA_NOTIFY_ENDPOINT}")

    last_idle = 0.0

    while True:
        job_id: Optional[str] = None
        try:
            jobs = sb_get(
                "user_loras",
                {"status": "eq.queued", "order": "created_at.asc", "limit": 1},
            )

            if not jobs:
                if time.time() - last_idle >= IDLE_LOG_SECONDS:
                    log("⏳ No queued jobs — waiting")
                    last_idle = time.time()
                time.sleep(POLL_SECONDS)
                continue

            job_id = jobs[0]["id"]
            log(f"📥 Found job {job_id}")

            sb_patch_safe(
                "user_loras", {"status": "training", "progress": 1}, {"id": f"eq.{job_id}"}
            )

            ds = prepare_dataset(job_id)
            local_artifact = run_training(job_id, ds)

            # ✅ Build A: upload final artifact to Supabase Storage
            storage_path = upload_artifact_to_storage(local_artifact, job_id)

            # ✅ Mark completed + persist storage reference (schema-safe)
            sb_patch_safe(
                "user_loras",
                {
                    "status": "completed",
                    "progress": 100,
                    "artifact_storage_path": storage_path,
                    "artifact_bucket": ARTIFACT_BUCKET,
                    "artifact_local_path": local_artifact,
                },
                {"id": f"eq.{job_id}"},
            )

            # ✅ Notify (terminal state only)
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

                    # ✅ Notify (terminal state only)
                    notify_status(job_id, "failed")

            except Exception as pe:
                log(f"⚠️ Failed to patch failure status: {pe}")

            log(f"❌ Job failed: {e}")
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    worker_main()
