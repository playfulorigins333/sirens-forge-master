#!/usr/bin/env python3
"""
SirensForge - Always-on LoRA Training Worker (PRODUCTION)
OPTION B — STORAGE HANDOFF (REST ONLY)

✔ sd-scripts compatible dataset structure
✔ Dynamic repeat/steps (~1200 effective samples)
✔ Explicit LoRA network module
✔ Class token enforced (prevents silent dataset rejection)
✔ Hard-fail on bad dataset or fake success
✔ Supabase schema-safe PATCH
"""

import os
import sys
import time
import json
import shutil
import subprocess
from typing import Dict, Any, List, Optional, Tuple

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

STORAGE_BUCKET = os.getenv("LORA_DATASET_BUCKET", "lora-datasets")
STORAGE_PREFIX = os.getenv("LORA_DATASET_PREFIX_ROOT", "lora_datasets")

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

ARTIFACT_MIN_BYTES = 2 * 1024 * 1024  # 2MB

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}


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


# ─────────────────────────────────────────────────────────────
# Supabase helpers
# ─────────────────────────────────────────────────────────────
def sb_get(path: str, params: Dict[str, Any]):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=HEADERS, params=params, timeout=20)
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
# Storage helpers
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
# Repeat logic
# ─────────────────────────────────────────────────────────────
def compute_repeat(image_count: int) -> Tuple[int, int]:
    repeat = round(TARGET_SAMPLES / image_count)
    repeat = max(1, repeat)
    return repeat, image_count * repeat


# ─────────────────────────────────────────────────────────────
# Dataset builder
# ─────────────────────────────────────────────────────────────
def prepare_dataset(job_id: str) -> Dict[str, Any]:
    base = os.path.join(LOCAL_TRAIN_ROOT, f"sf_{job_id}")
    shutil.rmtree(base, ignore_errors=True)
    os.makedirs(base, exist_ok=True)

    prefix = f"{STORAGE_PREFIX}/{job_id}"
    objects = list_storage_objects(prefix)
    files = [o["name"] for o in objects if o.get("name")]

    if not files:
        raise RuntimeError("No images in storage")

    tmp = os.path.join(base, "_tmp")
    os.makedirs(tmp, exist_ok=True)

    for f in files:
        url = signed_download_url(f"{prefix}/{f}")
        r = requests.get(url, timeout=180)
        r.raise_for_status()
        with open(os.path.join(tmp, f), "wb") as out:
            out.write(r.content)

    images = [f for f in os.listdir(tmp) if f.lower().endswith((".jpg", ".png", ".jpeg", ".webp"))]
    if not (MIN_IMAGES <= len(images) <= MAX_IMAGES):
        raise RuntimeError(f"Invalid image count: {len(images)}")

    repeat, effective = compute_repeat(len(images))
    concept = os.path.join(base, f"{repeat}_concept")
    os.makedirs(concept, exist_ok=True)

    for f in images:
        shutil.move(os.path.join(tmp, f), os.path.join(concept, f))
    shutil.rmtree(tmp, ignore_errors=True)

    log(f"📊 Images={len(images)} → repeat={repeat} → samples≈{effective}")

    return {
        "base_dir": base,
        "repeat": repeat,
        "steps": effective,
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
        "--pretrained_model_name_or_path", PRETRAINED_MODEL,
        "--vae", VAE_PATH,
        "--train_data_dir", ds["base_dir"],
        "--output_dir", out,
        "--output_name", name,
        "--network_module", NETWORK_MODULE,
        "--class_tokens", "concept",
        "--resolution", "1024,1024",
        "--train_batch_size", "1",
        "--learning_rate", "1e-4",
        "--max_train_steps", str(ds["steps"]),
        "--network_dim", "64",
        "--network_alpha", "32",
        "--mixed_precision", "fp16",
        "--save_model_as", "safetensors",
        "--save_every_n_steps", "200",
    ]

    log("🔥 Starting training")
    log("CMD: " + " ".join(cmd))

    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in p.stdout:
        print(line, end="")

    if p.wait() != 0:
        raise RuntimeError("Training failed")

    if not os.path.exists(artifact) or os.path.getsize(artifact) < ARTIFACT_MIN_BYTES:
        raise RuntimeError("Training produced invalid artifact")

    log(f"✅ Artifact created: {artifact}")
    return artifact


# ─────────────────────────────────────────────────────────────
# Worker loop
# ─────────────────────────────────────────────────────────────
def worker_main():
    sanity_checks()
    log("🚀 LoRA worker started (PRODUCTION)")
    log(f"NETWORK_MODULE={NETWORK_MODULE}")

    while True:
        try:
            jobs = sb_get("user_loras", {"status": "eq.queued", "order": "created_at.asc", "limit": 1})
            if not jobs:
                time.sleep(POLL_SECONDS)
                continue

            job_id = jobs[0]["id"]
            log(f"📥 Found job {job_id}")

            sb_patch_safe("user_loras", {"status": "training", "progress": 1}, {"id": f"eq.{job_id}"})

            ds = prepare_dataset(job_id)
            artifact = run_training(job_id, ds)

            sb_patch_safe(
                "user_loras",
                {"status": "completed", "progress": 100, "artifact_path": artifact},
                {"id": f"eq.{job_id}"},
            )

            log(f"✅ Completed job {job_id}")

        except Exception as e:
            log(f"❌ Job failed: {e}")
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    worker_main()
