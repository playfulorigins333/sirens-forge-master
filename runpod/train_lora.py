#!/usr/bin/env python3
"""
SirensForge - Always-on LoRA Training Worker (PRODUCTION)
QUEUED ONLY + user_id NOT NULL

- R2 datasets only: lora_datasets/<lora_id>/
- R2 artifacts: loras/<lora_id>/final.safetensors
- No reclaim logic
- No shell syntax
"""

import os
import sys
import time
import uuid
import re
import shutil
import subprocess
from typing import Dict, Any, List, Optional

import requests
import boto3
from botocore.config import Config as BotoConfig


# ─────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────
def log(msg: str) -> None:
    print(f"[train_lora_worker] {msg}", flush=True)


# ─────────────────────────────────────────────────────────────
# UUID safety
# ─────────────────────────────────────────────────────────────
CONTROL_CHARS_RE = re.compile(r"[\x00-\x1F\x7F]")

def sanitize_uuid(raw: Any) -> str:
    s = CONTROL_CHARS_RE.sub("", str(raw)).strip()
    return str(uuid.UUID(s))


# ─────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

R2_ACCESS_KEY_ID = os.environ["R2_ACCESS_KEY_ID"]
R2_SECRET_ACCESS_KEY = os.environ["R2_SECRET_ACCESS_KEY"]
R2_ENDPOINT = os.environ["R2_ENDPOINT"]
R2_BUCKET = os.environ["R2_BUCKET"]

PRETRAINED_MODEL = os.environ["PRETRAINED_MODEL"]
VAE_PATH = os.environ["VAE_PATH"]

TRAIN_SCRIPT = "/workspace/sd-scripts/sdxl_train_network.py"
PYTHON_BIN = sys.executable

LOCAL_TRAIN_ROOT = "/workspace/train_data"
OUTPUT_ROOT = "/workspace/output_loras"

DATASET_PREFIX = "lora_datasets"
ARTIFACT_PREFIX = "loras"

POLL_SECONDS = 5
IDLE_LOG_SECONDS = 30

MIN_IMAGES = 10
MAX_IMAGES = 20
TARGET_SAMPLES = 1200

CAPTION_EXTENSION = ".txt"
CONCEPT_TOKEN = "concept"

ARTIFACT_MIN_BYTES = 2 * 1024 * 1024


HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}


# ─────────────────────────────────────────────────────────────
# Clients
# ─────────────────────────────────────────────────────────────
def make_r2_client():
    session = boto3.session.Session()
    return session.client(
        "s3",
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        endpoint_url=R2_ENDPOINT,
        config=BotoConfig(region_name="auto", signature_version="s3v4"),
    )


def sb_get_queued():
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/user_loras",
        headers=HEADERS,
        params={
            "status": "eq.queued",
            "user_id": "is.not.null",
            "limit": 1,
        },
        timeout=20,
    )
    r.raise_for_status()
    return r.json() or []


def sb_update(lora_id: str, payload: Dict[str, Any]):
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/user_loras",
        headers=HEADERS,
        params={"id": f"eq.{lora_id}"},
        json=payload,
        timeout=20,
    )
    r.raise_for_status()


# ─────────────────────────────────────────────────────────────
# Dataset
# ─────────────────────────────────────────────────────────────
def prepare_dataset(lora_id: str) -> Dict[str, Any]:
    s3 = make_r2_client()
    prefix = f"{DATASET_PREFIX}/{lora_id}/"

    resp = s3.list_objects_v2(Bucket=R2_BUCKET, Prefix=prefix)
    keys = [o["Key"] for o in resp.get("Contents", [])]

    if not keys:
        raise RuntimeError("No dataset found in R2")

    base = f"{LOCAL_TRAIN_ROOT}/sf_{lora_id}"
    shutil.rmtree(base, ignore_errors=True)
    os.makedirs(base, exist_ok=True)

    tmp = f"{base}/_tmp"
    os.makedirs(tmp, exist_ok=True)

    for k in keys:
        fn = os.path.basename(k)
        s3.download_file(R2_BUCKET, k, f"{tmp}/{fn}")

    images = [f for f in os.listdir(tmp) if f.lower().endswith((".jpg", ".png", ".jpeg"))]
    if not (MIN_IMAGES <= len(images) <= MAX_IMAGES):
        raise RuntimeError("Invalid image count")

    repeat = max(1, round(TARGET_SAMPLES / len(images)))
    concept_dir = f"{base}/{repeat}_{CONCEPT_TOKEN}"
    os.makedirs(concept_dir, exist_ok=True)

    for img in images:
        shutil.move(f"{tmp}/{img}", f"{concept_dir}/{img}")
        with open(f"{concept_dir}/{os.path.splitext(img)[0]}{CAPTION_EXTENSION}", "w") as f:
            f.write(CONCEPT_TOKEN)

    shutil.rmtree(tmp, ignore_errors=True)
    return {"base_dir": base, "steps": len(images) * repeat}


# ─────────────────────────────────────────────────────────────
# Training
# ─────────────────────────────────────────────────────────────
def run_training(lora_id: str, ds: Dict[str, Any]) -> str:
    out = f"{OUTPUT_ROOT}/sf_{lora_id}"
    os.makedirs(out, exist_ok=True)

    artifact = f"{out}/sf_{lora_id}.safetensors"

    cmd = [
        PYTHON_BIN,
        TRAIN_SCRIPT,
        "--pretrained_model_name_or_path", PRETRAINED_MODEL,
        "--vae", VAE_PATH,
        "--train_data_dir", ds["base_dir"],
        "--caption_extension", CAPTION_EXTENSION,
        "--output_dir", out,
        "--output_name", f"sf_{lora_id}",
        "--network_module", "networks.lora",
        "--resolution", "1024,1024",
        "--train_batch_size", "1",
        "--learning_rate", "1e-4",
        "--max_train_steps", str(ds["steps"]),
        "--network_dim", "64",
        "--network_alpha", "32",
        "--mixed_precision", "fp16",
        "--save_model_as", "safetensors",
    ]

    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in p.stdout:
        print(line, end="")
    if p.wait() != 0 or not os.path.exists(artifact):
        raise RuntimeError("Training failed")

    return artifact


# ─────────────────────────────────────────────────────────────
# Worker loop
# ─────────────────────────────────────────────────────────────
def worker_main():
    log("🚀 LoRA worker started (QUEUED ONLY + user_id NOT NULL)")

    last_idle = 0.0

    while True:
        try:
            jobs = sb_get_queued()
            if not jobs:
                if time.time() - last_idle > IDLE_LOG_SECONDS:
                    log("⏳ No queued jobs — waiting")
                    last_idle = time.time()
                time.sleep(POLL_SECONDS)
                continue

            lora_id = sanitize_uuid(jobs[0]["id"])
            log(f"📥 Picked job {lora_id}")

            sb_update(lora_id, {"status": "training"})

            ds = prepare_dataset(lora_id)
            artifact = run_training(lora_id, ds)

            s3 = make_r2_client()
            r2_key = f"{ARTIFACT_PREFIX}/{lora_id}/final.safetensors"
            s3.upload_file(artifact, R2_BUCKET, r2_key)

            sb_update(
                lora_id,
                {
                    "status": "completed",
                    "progress": 100,
                    "artifact_r2_bucket": R2_BUCKET,
                    "artifact_r2_key": r2_key,
                },
            )

            log(f"✅ Completed job {lora_id}")

        except Exception as e:
            log(f"❌ Job failed: {e}")
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    worker_main()
