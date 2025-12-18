#!/usr/bin/env python3
"""
SirensForge - Always-on LoRA Training Worker
OPTION B — STORAGE HANDOFF (REST ONLY)

LOCKED BEHAVIOR:
- Image count: 10–20
- repeat = round(1200 / image_count)
- sd-scripts structure:
    train_data_dir/
      concept_<repeat>/
        img_*.jpg
- --train_data_dir MUST be the parent directory
- NEVER hard-code max_train_steps
"""

import os
import sys
import time
import shutil
import subprocess
from typing import Dict, Any, List

import requests


# ──────────────────────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────────────────────
def log(msg: str) -> None:
    print(f"[train_lora_worker] {msg}", flush=True)


def require_env(name: str) -> str:
    v = os.getenv(name)
    if not v:
        raise RuntimeError(f"Missing env: {name}")
    return v


# ──────────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────────
SUPABASE_URL = require_env("SUPABASE_URL").rstrip("/")
SUPABASE_KEY = require_env("SUPABASE_SERVICE_ROLE_KEY")

PRETRAINED_MODEL = require_env("PRETRAINED_MODEL")
VAE_PATH = require_env("VAE_PATH")

STORAGE_BUCKET = os.getenv("LORA_DATASET_BUCKET", "lora-datasets")
STORAGE_PREFIX = os.getenv("LORA_DATASET_PREFIX_ROOT", "lora_datasets")

LOCAL_TRAIN_ROOT = "/workspace/train_data"
OUTPUT_ROOT = "/workspace/output_loras"

TRAIN_SCRIPT = "/workspace/sd-scripts/sdxl_train_network.py"
PYTHON_BIN = sys.executable

POLL_SECONDS = 5
IDLE_LOG_SECONDS = 30

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
    return True


# ──────────────────────────────────────────────────────────────────────────────
# Storage helpers
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


def signed_download_url(path: str) -> str:
    r = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/sign/{STORAGE_BUCKET}/{path}",
        headers=HEADERS,
        json={"expiresIn": 3600},
        timeout=10,
    )
    r.raise_for_status()

    signed = r.json().get("signedURL")
    if not signed:
        raise RuntimeError("Supabase did not return signedURL")

    if signed.startswith("/"):
        signed = f"{SUPABASE_URL}/storage/v1{signed}"

    return signed


# ──────────────────────────────────────────────────────────────────────────────
# Dataset handling (CRITICAL FIX)
# ──────────────────────────────────────────────────────────────────────────────
def prepare_dataset(job_id: str) -> str:
    base_dir = f"{LOCAL_TRAIN_ROOT}/sf_{job_id}"
    shutil.rmtree(base_dir, ignore_errors=True)
    os.makedirs(base_dir, exist_ok=True)

    prefix = f"{STORAGE_PREFIX}/{job_id}"
    objects = list_storage_objects(prefix)

    files = [o["name"] for o in objects if o.get("name")]
    if not files:
        raise RuntimeError(f"No images found in storage for job {job_id}")

    # Download all images first
    temp_dir = f"{base_dir}/_raw"
    os.makedirs(temp_dir, exist_ok=True)

    for name in sorted(files):
        remote_path = f"{prefix}/{name}"
        url = signed_download_url(remote_path)

        r = requests.get(url, timeout=120)
        r.raise_for_status()

        with open(f"{temp_dir}/{name}", "wb") as f:
            f.write(r.content)

    images = [
        f for f in os.listdir(temp_dir)
        if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
    ]

    image_count = len(images)
    if not (10 <= image_count <= 20):
        raise RuntimeError(f"Invalid image count: {image_count}")

    # 🔐 LOCKED FORMULA
    repeat = round(1200 / image_count)
    effective = image_count * repeat

    log(f"📊 Images={image_count} → repeat={repeat} → samples≈{effective}")

    concept_dir = f"{base_dir}/concept_{repeat}"
    os.makedirs(concept_dir, exist_ok=True)

    for name in images:
        shutil.move(f"{temp_dir}/{name}", f"{concept_dir}/{name}")

    shutil.rmtree(temp_dir, ignore_errors=True)

    return base_dir  # MUST be parent directory


# ──────────────────────────────────────────────────────────────────────────────
# Training
# ──────────────────────────────────────────────────────────────────────────────
def run_training(job_id: str, dataset_dir: str):
    out_dir = f"{OUTPUT_ROOT}/sf_{job_id}"
    os.makedirs(out_dir, exist_ok=True)

    cmd = [
        PYTHON_BIN,
        TRAIN_SCRIPT,
        "--pretrained_model_name_or_path", PRETRAINED_MODEL,
        "--vae", VAE_PATH,
        "--train_data_dir", dataset_dir,
        "--output_dir", out_dir,
        "--output_name", f"sf_{job_id}",
        "--resolution", "1024,1024",
        "--train_batch_size", "1",
        "--learning_rate", "1e-4",
        "--network_dim", "64",
        "--network_alpha", "32",
        "--mixed_precision", "fp16",
        "--save_model_as", "safetensors",
    ]

    log("🔥 Starting training")
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
    log("🚀 LoRA worker started")
    log(f"Using PRETRAINED_MODEL={PRETRAINED_MODEL}")
    log(f"Using VAE_PATH={VAE_PATH}")

    last_idle = 0

    while True:
        job_id = None
        try:
            jobs = sb_get(
                "user_loras",
                {"status": "eq.queued", "order": "created_at.asc", "limit": 1},
            )

            if not jobs:
                if time.time() - last_idle > IDLE_LOG_SECONDS:
                    log("⏳ No queued jobs — waiting")
                    last_idle = time.time()
                time.sleep(POLL_SECONDS)
                continue

            job_id = jobs[0]["id"]
            log(f"📥 Found job {job_id}")

            sb_patch(
                "user_loras",
                {"status": "training", "progress": 1, "error_message": None},
                {"id": f"eq.{job_id}", "status": "eq.queued"},
            )

            dataset_dir = prepare_dataset(job_id)
            sb_patch("user_loras", {"progress": 15}, {"id": f"eq.{job_id}"})

            run_training(job_id, dataset_dir)

            sb_patch(
                "user_loras",
                {"status": "completed", "progress": 100},
                {"id": f"eq.{job_id}"},
            )

            log(f"✅ Completed job {job_id}")

        except Exception as e:
            msg = str(e)
            log(f"❌ Job failed: {msg}")

            if job_id:
                try:
                    sb_patch(
                        "user_loras",
                        {"status": "failed", "error_message": msg, "progress": 0},
                        {"id": f"eq.{job_id}"},
                    )
                except Exception as ee:
                    log(f"❌ Failed to mark job failed in Supabase: {ee}")

            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    worker_main()
