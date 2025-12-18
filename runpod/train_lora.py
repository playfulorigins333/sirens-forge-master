#!/usr/bin/env python3
"""
SirensForge - Always-on LoRA Training Worker
OPTION B — STORAGE HANDOFF (REST ONLY)

Flow:
1) Poll Supabase (REST) FIFO for user_loras.status='queued'
2) Atomically claim job -> status='training'
3) Download images from Supabase Storage via signed URLs
4) Build local dataset (sd-scripts compatible):
     /workspace/train_data/sf_<lora_id>/
       <repeat>_concept/
         img_*.jpg
   (train_data_dir MUST be the parent: /workspace/train_data/sf_<lora_id>)
5) Run sd-scripts
6) Validate artifact exists (no fake completions)
7) Update job -> completed / failed
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

    # Supabase returns relative signedURL sometimes; must be downloaded via /storage/v1
    if signed.startswith("/"):
        signed = f"{SUPABASE_URL}/storage/v1{signed}"

    return signed


# ──────────────────────────────────────────────────────────────────────────────
# Dataset handling (sd-scripts repeat folder naming FIX)
# ──────────────────────────────────────────────────────────────────────────────
def prepare_dataset(job_id: str) -> Dict[str, Any]:
    """
    sd-scripts expects repeats as: <repeat>_<conceptname>
    Example:
      /workspace/train_data/sf_<job_id>/120_concept/img_1.jpg ...

    Returns:
      {
        "train_root": base_dir,          # pass to --train_data_dir
        "image_count": N,
        "repeat": R,
        "concept_dir": ".../R_concept"
      }
    """
    base_dir = f"{LOCAL_TRAIN_ROOT}/sf_{job_id}"
    shutil.rmtree(base_dir, ignore_errors=True)
    os.makedirs(base_dir, exist_ok=True)

    prefix = f"{STORAGE_PREFIX}/{job_id}"
    objects = list_storage_objects(prefix)

    files = [o["name"] for o in objects if o.get("name")]
    if not files:
        raise RuntimeError(f"No images found in storage for job {job_id}")

    tmp_dir = f"{base_dir}/_raw"
    os.makedirs(tmp_dir, exist_ok=True)

    for name in sorted(files):
        remote_path = f"{prefix}/{name}"
        url = signed_download_url(remote_path)
        r = requests.get(url, timeout=120)
        r.raise_for_status()
        with open(f"{tmp_dir}/{name}", "wb") as f:
            f.write(r.content)

    images = [
        f for f in os.listdir(tmp_dir)
        if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
    ]

    image_count = len(images)
    if not (10 <= image_count <= 20):
        raise RuntimeError(f"Invalid image count: {image_count}")

    # 🔒 LOCKED: dynamic repeat to ~1200 effective samples
    repeat = round(1200 / image_count)
    effective = image_count * repeat
    log(f"📊 Images={image_count} → repeat={repeat} → samples≈{effective}")

    concept_dir = f"{base_dir}/{repeat}_concept"
    os.makedirs(concept_dir, exist_ok=True)

    for name in images:
        shutil.move(f"{tmp_dir}/{name}", f"{concept_dir}/{name}")

    shutil.rmtree(tmp_dir, ignore_errors=True)

    # Final sanity: concept dir must contain images
    final_images = [
        f for f in os.listdir(concept_dir)
        if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
    ]
    if len(final_images) != image_count:
        raise RuntimeError(f"Dataset move mismatch: expected {image_count}, got {len(final_images)}")

    return {
        "train_root": base_dir,
        "image_count": image_count,
        "repeat": repeat,
        "concept_dir": concept_dir,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Training + Artifact Gate (NO fake completions)
# ──────────────────────────────────────────────────────────────────────────────
def run_training(job_id: str, train_root: str) -> str:
    out_dir = f"{OUTPUT_ROOT}/sf_{job_id}"
    os.makedirs(out_dir, exist_ok=True)

    output_name = f"sf_{job_id}"
    expected_file = f"{out_dir}/{output_name}.safetensors"

    cmd = [
        PYTHON_BIN,
        TRAIN_SCRIPT,
        "--pretrained_model_name_or_path", PRETRAINED_MODEL,
        "--vae", VAE_PATH,
        "--train_data_dir", train_root,
        "--output_dir", out_dir,
        "--output_name", output_name,
        "--resolution", "1024,1024",
        "--train_batch_size", "1",
        "--learning_rate", "1e-4",
        "--network_dim", "64",
        "--network_alpha", "32",
        "--mixed_precision", "fp16",
        "--save_model_as", "safetensors",
    ]

    # Print safely so flags can't "look glued"
    log("🔥 Starting training")
    log("CMD (list): " + repr(cmd))
    log("CMD (shell): " + " ".join(cmd))

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    saw_no_data = False

    for line in proc.stdout:
        print(line, end="")
        if "No data found" in line:
            saw_no_data = True

    rc = proc.wait()
    if rc != 0:
        raise RuntimeError(f"Training process failed (exit={rc})")

    # Hard gate: sd-scripts sometimes prints an error and can still exit weirdly.
    if saw_no_data:
        raise RuntimeError("Training aborted: No data found (dataset not detected by sd-scripts)")

    # Artifact gate: MUST exist and be non-trivial size
    if not os.path.exists(expected_file):
        raise RuntimeError(f"Training produced no artifact: missing {expected_file}")

    size_mb = os.path.getsize(expected_file) / (1024 * 1024)
    if size_mb < 1.0:
        raise RuntimeError(f"Training artifact too small ({size_mb:.2f} MB): {expected_file}")

    return expected_file


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

            ds = prepare_dataset(job_id)
            sb_patch(
                "user_loras",
                {
                    "progress": 15,
                    "image_count": ds["image_count"],
                    "repeat": ds["repeat"],
                },
                {"id": f"eq.{job_id}"},
            )

            artifact = run_training(job_id, ds["train_root"])

            sb_patch(
                "user_loras",
                {
                    "status": "completed",
                    "progress": 100,
                    "artifact_path": artifact,
                },
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
