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

# Caption enforcement (SDXL-safe)
CONCEPT_TOKEN = os.getenv("LORA_CONCEPT_TOKEN", "concept")
CAPTION_EXTENSION = os.getenv("LORA_CAPTION_EXTENSION", ".txt")  # passed to sd-scripts

ARTIFACT_MIN_BYTES = 2 * 1024 * 1024  # 2MB

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
        raise RuntimeError("LORA_CAPTION_EXTENSION must start with '.' (e.g. .txt)")


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
    """
    PATCH and auto-strip unknown columns if Supabase returns:
    "Could not find the 'col' column of 'table' in the schema cache"
    """
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
    """
    Returns objects under prefix. Supabase may include folders; we filter later.
    """
    r = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/list/{STORAGE_BUCKET}",
        headers=HEADERS,
        json={"prefix": prefix},
        timeout=20,
    )
    r.raise_for_status()
    return r.json()


def signed_download_url(path: str) -> str:
    """
    path is the full object key inside the bucket (e.g. lora_datasets/<job>/<file>)
    """
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
    """
    sd-scripts repeats: directory name like "{repeat}_concept"
    Choose repeat so effective samples ~= TARGET_SAMPLES.
    """
    repeat = round(TARGET_SAMPLES / image_count)
    repeat = max(1, repeat)
    effective = image_count * repeat
    return repeat, effective


# ─────────────────────────────────────────────────────────────
# Dataset builder
# ─────────────────────────────────────────────────────────────
def _write_caption_for_image(image_path: str) -> None:
    """
    SDXL concept enforcement: create a caption file next to the image.
    image.jpg -> image.txt (or configured extension) containing "concept"
    """
    root, _ext = os.path.splitext(image_path)
    cap_path = root + CAPTION_EXTENSION
    with open(cap_path, "w", encoding="utf-8") as f:
        f.write(CONCEPT_TOKEN)


def prepare_dataset(job_id: str) -> Dict[str, Any]:
    """
    Creates:
      /workspace/train_data/sf_<job_id>/
        {repeat}_concept/
          img1.jpg
          img1.txt  (contains "concept")
          ...
    """
    base = os.path.join(LOCAL_TRAIN_ROOT, f"sf_{job_id}")
    shutil.rmtree(base, ignore_errors=True)
    os.makedirs(base, exist_ok=True)

    prefix = f"{STORAGE_PREFIX}/{job_id}"
    objects = list_storage_objects(prefix)

    # "name" is usually the filename relative to prefix (not always guaranteed)
    names = [o.get("name") for o in objects if o.get("name")]
    if not names:
        raise RuntimeError("No files found in storage for this job")

    tmp = os.path.join(base, "_tmp")
    os.makedirs(tmp, exist_ok=True)

    # Download everything under prefix; we filter to images after download
    for name in names:
        # Some listings may return nested paths; preserve basename only for local tmp
        local_name = os.path.basename(name)
        object_key = f"{prefix}/{name}".replace("//", "/")

        url = signed_download_url(object_key)
        r = requests.get(url, timeout=180)
        r.raise_for_status()
        with open(os.path.join(tmp, local_name), "wb") as out:
            out.write(r.content)

    images = [f for f in os.listdir(tmp) if f.lower().endswith(IMAGE_EXTS)]
    img_count = len(images)

    if not (MIN_IMAGES <= img_count <= MAX_IMAGES):
        raise RuntimeError(f"Invalid image count: {img_count} (must be {MIN_IMAGES}-{MAX_IMAGES})")

    repeat, effective = compute_repeat(img_count)

    # sd-scripts repeats folder
    concept_dir = os.path.join(base, f"{repeat}_{CONCEPT_TOKEN}")
    os.makedirs(concept_dir, exist_ok=True)

    # Move images + create captions
    for fname in images:
        src = os.path.join(tmp, fname)
        dst = os.path.join(concept_dir, fname)
        shutil.move(src, dst)
        _write_caption_for_image(dst)

    shutil.rmtree(tmp, ignore_errors=True)

    log(f"📊 Images={img_count} → repeat={repeat} → samples≈{effective}")
    log(f"🧾 Captions: {CAPTION_EXTENSION} = '{CONCEPT_TOKEN}'")

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

    # SDXL sd-scripts: concept must come from captions, not --class_tokens
    cmd = [
        PYTHON_BIN,
        TRAIN_SCRIPT,
        "--pretrained_model_name_or_path", PRETRAINED_MODEL,
        "--vae", VAE_PATH,
        "--train_data_dir", ds["base_dir"],
        "--caption_extension", CAPTION_EXTENSION,  # <- CRITICAL
        "--output_dir", out,
        "--output_name", name,
        "--network_module", NETWORK_MODULE,
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
    if p.stdout is None:
        raise RuntimeError("Failed to start training process (no stdout)")

    for line in p.stdout:
        print(line, end="")

    rc = p.wait()
    if rc != 0:
        raise RuntimeError(f"Training failed (exit code {rc})")

    if (not os.path.exists(artifact)) or (os.path.getsize(artifact) < ARTIFACT_MIN_BYTES):
        raise RuntimeError("Training produced invalid artifact (missing or too small)")

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

    last_idle_log = 0.0

    while True:
        job_id: Optional[str] = None
        try:
            jobs = sb_get(
                "user_loras",
                {"status": "eq.queued", "order": "created_at.asc", "limit": 1},
            )

            if not jobs:
                now = time.time()
                if now - last_idle_log >= IDLE_LOG_SECONDS:
                    log("⏳ No queued jobs — waiting")
                    last_idle_log = now
                time.sleep(POLL_SECONDS)
                continue

            job_id = jobs[0]["id"]
            log(f"📥 Found job {job_id}")

            # Mark as training
            sb_patch_safe("user_loras", {"status": "training", "progress": 1}, {"id": f"eq.{job_id}"})

            # Build dataset
            ds = prepare_dataset(job_id)

            # Train
            artifact = run_training(job_id, ds)

            # Mark completed
            sb_patch_safe(
                "user_loras",
                {"status": "completed", "progress": 100, "artifact_path": artifact},
                {"id": f"eq.{job_id}"},
            )

            log(f"✅ Completed job {job_id}")

        except Exception as e:
            # Best-effort: mark failed
            try:
                if job_id:
                    sb_patch_safe(
                        "user_loras",
                        {"status": "failed", "progress": 0, "error_message": str(e)},
                        {"id": f"eq.{job_id}"},
                    )
            except Exception as patch_err:
                log(f"⚠️ Failed to PATCH failure status: {patch_err}")

            log(f"❌ Job failed: {e}")
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    worker_main()
