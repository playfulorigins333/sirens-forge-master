#!/usr/bin/env python3
"""
SirensForge - Always-on LoRA Training Worker
OPTION B — STORAGE HANDOFF (REST ONLY)

Flow:
1) Poll Supabase (REST) FIFO for user_loras.status='queued'
2) Atomically claim job -> status='training'
3) Download images from Supabase Storage via signed URLs
4) Build local dataset:
     /workspace/train_data/sf_<lora_id>/
5) Run sd-scripts
6) Update job -> completed / failed
"""

import os
import sys
import time
import shutil
import subprocess
from typing import Dict, Any, List

import requests


# ──────────────────────────────────────────────────────────────────────────────
# Logging helpers
# ──────────────────────────────────────────────────────────────────────────────
def log(msg: str) -> None:
    print(f"[train_lora_worker] {msg}", flush=True)


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing env: {name}")
    return value


# ──────────────────────────────────────────────────────────────────────────────
# Environment / Config
# ──────────────────────────────────────────────────────────────────────────────
SUPABASE_URL = require_env("SUPABASE_URL").rstrip("/")
SUPABASE_KEY = require_env("SUPABASE_SERVICE_ROLE_KEY")

PRETRAINED_MODEL = require_env("PRETRAINED_MODEL")
VAE_PATH = require_env("VAE_PATH")

if not os.path.exists(PRETRAINED_MODEL):
    raise RuntimeError(f"PRETRAINED_MODEL not found: {PRETRAINED_MODEL}")

if not os.path.exists(VAE_PATH):
    raise RuntimeError(f"VAE_PATH not found: {VAE_PATH}")

STORAGE_BUCKET = os.getenv("LORA_DATASET_BUCKET", "lora-datasets")
STORAGE_PREFIX = os.getenv("LORA_DATASET_PREFIX_ROOT", "lora_datasets")

LOCAL_TRAIN_ROOT = os.getenv("LORA_LOCAL_TRAIN_ROOT", "/workspace/train_data")
OUTPUT_ROOT = os.getenv("LORA_OUTPUT_ROOT", "/workspace/output_loras")

TRAIN_SCRIPT = os.getenv(
    "TRAIN_SCRIPT",
    "/workspace/sd-scripts/sdxl_train_network.py",
)
PYTHON_BIN = os.getenv("PYTHON_BIN", sys.executable)

POLL_SECONDS = int(os.getenv("LORA_POLL_SECONDS", "5"))
IDLE_LOG_SECONDS = int(os.getenv("LORA_IDLE_LOG_SECONDS", "30"))

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}


# ──────────────────────────────────────────────────────────────────────────────
# Supabase REST helpers
# ──────────────────────────────────────────────────────────────────────────────
def sb_get(path: str, params: Dict[str, Any] = None):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers=HEADERS,
        params=params,
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def sb_patch(path: str, payload: Dict[str, Any], params: Dict[str, Any]):
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers=HEADERS,
        json=payload,
        params=params,
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


# ──────────────────────────────────────────────────────────────────────────────
# Supabase Storage helpers
# ──────────────────────────────────────────────────────────────────────────────
def list_storage_objects(prefix: str) -> List[Dict[str, Any]]:
    r = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/list/{STORAGE_BUCKET}",
        headers=HEADERS,
        json={"prefix": prefix},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def signed_url(object_path: str) -> str:
    """
    Supabase returns a RELATIVE signedURL.
    We must convert it to a full https URL before downloading.
    """
    r = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/sign/{STORAGE_BUCKET}/{object_path}",
        headers=HEADERS,
        json={"expiresIn": 3600},
        timeout=10,
    )
    r.raise_for_status()

    signed_path = r.json().get("signedURL")
    if not signed_path:
        raise RuntimeError("Supabase did not return signedURL")

    # Supabase returns `/object/sign/...`
    if signed_path.startswith("/"):
        return f"{SUPABASE_URL}/storage/v1{signed_path}"

    return signed_path


# ──────────────────────────────────────────────────────────────────────────────
# Dataset preparation
# ──────────────────────────────────────────────────────────────────────────────
def prepare_dataset(job_id: str) -> str:
    local_dir = os.path.join(LOCAL_TRAIN_ROOT, f"sf_{job_id}")
    shutil.rmtree(local_dir, ignore_errors=True)
    os.makedirs(local_dir, exist_ok=True)

    prefix = f"{STORAGE_PREFIX}/{job_id}"
    objects = list_storage_objects(prefix)

    files = [obj["name"] for obj in objects if obj.get("name")]
    if not files:
        raise RuntimeError(f"No images found in storage for job {job_id}")

    for name in sorted(files):
        object_path = f"{prefix}/{name}"
        url = signed_url(object_path)

        resp = requests.get(url, timeout=120)
        resp.raise_for_status()

        with open(os.path.join(local_dir, name), "wb") as f:
            f.write(resp.content)

    images = [
        f for f in os.listdir(local_dir)
        if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
    ]

    if not (10 <= len(images) <= 20):
        raise RuntimeError(f"Invalid image count: {len(images)}")

    return local_dir


# ──────────────────────────────────────────────────────────────────────────────
# Training execution
# ──────────────────────────────────────────────────────────────────────────────
def run_training(job_id: str, dataset_dir: str):
    output_dir = os.path.join(OUTPUT_ROOT, f"sf_{job_id}")
    os.makedirs(output_dir, exist_ok=True)

    cmd = [
        PYTHON_BIN,
        TRAIN_SCRIPT,
        "--pretrained_model_name_or_path", PRETRAINED_MODEL,
        "--vae", VAE_PATH,
        "--train_data_dir", dataset_dir,
        "--output_dir", output_dir,
        "--output_name", f"sf_{job_id}",
        "--resolution", "1024,1024",
        "--train_batch_size", "1",
        "--learning_rate", "1e-4",
        "--max_train_steps", "1200",
        "--network_dim", "64",
        "--network_alpha", "32",
        "--mixed_precision", "fp16",
        "--save_model_as", "safetensors",
    ]

    log("🔥 Launching training")
    log("CMD: " + " ".join(cmd))

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    for line in proc.stdout:
        print(line, end="")

    if proc.wait() != 0:
        raise RuntimeError("Training process failed")


# ──────────────────────────────────────────────────────────────────────────────
# Worker loop
# ──────────────────────────────────────────────────────────────────────────────
def worker_main():
    log("🚀 LoRA worker started (REST + Storage handoff)")
    log(f"Using PRETRAINED_MODEL={PRETRAINED_MODEL}")
    log(f"Using VAE_PATH={VAE_PATH}")

    last_idle_log = 0

    while True:
        try:
            jobs = sb_get(
                "user_loras",
                {
                    "status": "eq.queued",
                    "order": "created_at.asc",
                    "limit": 1,
                },
            )

            if not jobs:
                if time.time() - last_idle_log > IDLE_LOG_SECONDS:
                    log("⏳ No queued jobs — waiting")
                    last_idle_log = time.time()
                time.sleep(POLL_SECONDS)
                continue

            job = jobs[0]
            job_id = job["id"]

            log(f"📥 Found job {job_id}")

            # Claim job
            sb_patch(
                "user_loras",
                {"status": "training", "progress": 1, "error_message": None},
                {"id": f"eq.{job_id}", "status": "eq.queued"},
            )

            log("📦 Downloading dataset")
            dataset_dir = prepare_dataset(job_id)

            sb_patch(
                "user_loras",
                {"progress": 15},
                {"id": f"eq.{job_id}"},
            )

            run_training(job_id, dataset_dir)

            sb_patch(
                "user_loras",
                {"status": "completed", "progress": 100},
                {"id": f"eq.{job_id}"},
            )

            log(f"✅ Completed job {job_id}")

        except Exception as e:
            error_msg = str(e)
            try:
                if "job_id" in locals():
                    sb_patch(
                        "user_loras",
                        {
                            "status": "failed",
                            "progress": 0,
                            "error_message": error_msg,
                        },
                        {"id": f"eq.{job_id}"},
                    )
                    log(f"❌ Failed job {job_id}: {error_msg}")
                else:
                    log(f"❌ Worker error: {error_msg}")
            except Exception as mark_err:
                log(f"❌ Failed to mark failure: {mark_err}")

            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    worker_main()
