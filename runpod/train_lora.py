#!/usr/bin/env python3
"""
SirensForge - Always-on LoRA Training Worker (PRODUCTION)
OPTION B — STORAGE HANDOFF (REST ONLY)

- Builds sd-scripts dataset as: /workspace/train_data/sf_<id>/<repeat>_concept/*.jpg
- Computes repeat & steps dynamically to ~1200 effective samples
- Runs sd-scripts with explicit --network_module networks.lora
- HARD FAILS on bad dataset even if sd-scripts exits 0
- Schema-safe Supabase PATCH (won't break if columns missing)
"""

import os
import sys
import time
import json
import shutil
import subprocess
from typing import Dict, Any, List, Optional, Tuple

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

# Storage (datasets)
STORAGE_BUCKET = os.getenv("LORA_DATASET_BUCKET", "lora-datasets")
STORAGE_PREFIX = os.getenv("LORA_DATASET_PREFIX_ROOT", "lora_datasets")

# Local paths
LOCAL_TRAIN_ROOT = os.getenv("LORA_LOCAL_TRAIN_ROOT", "/workspace/train_data")
OUTPUT_ROOT = os.getenv("LORA_OUTPUT_ROOT", "/workspace/output_loras")

# sd-scripts
TRAIN_SCRIPT = os.getenv("TRAIN_SCRIPT", "/workspace/sd-scripts/sdxl_train_network.py")
PYTHON_BIN = os.getenv("PYTHON_BIN", sys.executable)

# IMPORTANT: network module for LoRA (this fixes your crash)
NETWORK_MODULE = os.getenv("LORA_NETWORK_MODULE", "networks.lora")

# Worker timing
POLL_SECONDS = int(os.getenv("LORA_POLL_SECONDS", "5"))
IDLE_LOG_SECONDS = int(os.getenv("LORA_IDLE_LOG_SECONDS", "30"))

# Production gates
MIN_IMAGES = 10
MAX_IMAGES = 20
TARGET_SAMPLES = 1200

ARTIFACT_MIN_BYTES = int(os.getenv("LORA_ARTIFACT_MIN_BYTES", str(2 * 1024 * 1024)))  # 2MB default

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}


# ──────────────────────────────────────────────────────────────────────────────
# Sanity checks
# ──────────────────────────────────────────────────────────────────────────────
def sanity_checks() -> None:
    if not os.path.exists(PRETRAINED_MODEL):
        raise RuntimeError(f"PRETRAINED_MODEL not found: {PRETRAINED_MODEL}")
    if not os.path.exists(VAE_PATH):
        raise RuntimeError(f"VAE_PATH not found: {VAE_PATH}")
    if not os.path.exists(TRAIN_SCRIPT):
        raise RuntimeError(f"TRAIN_SCRIPT not found: {TRAIN_SCRIPT}")


# ──────────────────────────────────────────────────────────────────────────────
# Supabase REST helpers
# ──────────────────────────────────────────────────────────────────────────────
def sb_get(path: str, params: Dict[str, Any] = None) -> Any:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers=HEADERS,
        params=params,
        timeout=20,
    )
    r.raise_for_status()
    if not r.text:
        return None
    return r.json()


def _extract_unknown_column(err_text: str) -> Optional[str]:
    try:
        data = json.loads(err_text)
        msg = str(data.get("message", ""))
        marker = "Could not find the '"
        if marker in msg:
            after = msg.split(marker, 1)[1]
            col = after.split("'", 1)[0]
            return col.strip() or None
    except Exception:
        return None
    return None


def sb_patch_schema_safe(table: str, payload: Dict[str, Any], params: Dict[str, Any]) -> Any:
    if not payload:
        return None

    working = dict(payload)
    for _ in range(10):
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=HEADERS,
            json=working,
            params=params,
            timeout=20,
        )
        if 200 <= r.status_code < 300:
            if not r.text:
                return None
            try:
                return r.json()
            except Exception:
                return None

        if r.status_code != 400:
            r.raise_for_status()

        unknown = _extract_unknown_column(r.text or "")
        if not unknown:
            r.raise_for_status()

        if unknown in working:
            log(f"⚠️ Supabase schema missing column '{unknown}' — stripping it from PATCH and retrying")
            working.pop(unknown, None)
            continue

        r.raise_for_status()

    raise RuntimeError("Supabase PATCH failed after multiple schema-safe retries")


# ──────────────────────────────────────────────────────────────────────────────
# Storage helpers
# ──────────────────────────────────────────────────────────────────────────────
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

    signed = r.json().get("signedURL")
    if not signed:
        raise RuntimeError("Supabase did not return signedURL")

    if signed.startswith("/"):
        return f"{SUPABASE_URL}/storage/v1{signed}"

    if signed.startswith("http") and "/storage/v1/" not in signed:
        return signed.replace(SUPABASE_URL, f"{SUPABASE_URL}/storage/v1", 1)

    return signed


# ──────────────────────────────────────────────────────────────────────────────
# Repeat/steps logic (LOCKED)
# ──────────────────────────────────────────────────────────────────────────────
def compute_repeat_and_steps(image_count: int, batch_size: int = 1) -> Tuple[int, int, int]:
    repeat = int(round(TARGET_SAMPLES / float(image_count)))
    repeat = max(1, repeat)
    effective_samples = image_count * repeat
    max_train_steps = int(round(effective_samples / float(batch_size)))
    return repeat, effective_samples, max_train_steps


# ──────────────────────────────────────────────────────────────────────────────
# Dataset handling (sd-scripts compatible)
# ──────────────────────────────────────────────────────────────────────────────
def prepare_dataset(job_id: str) -> Dict[str, Any]:
    base_dir = os.path.join(LOCAL_TRAIN_ROOT, f"sf_{job_id}")
    shutil.rmtree(base_dir, ignore_errors=True)
    os.makedirs(base_dir, exist_ok=True)

    prefix = f"{STORAGE_PREFIX}/{job_id}"
    objects = list_storage_objects(prefix)
    files = [o.get("name") for o in objects if o.get("name")]

    if not files:
        raise RuntimeError(f"No images found in storage for job {job_id}")

    tmp_dir = os.path.join(base_dir, "_tmp_download")
    os.makedirs(tmp_dir, exist_ok=True)

    for name in sorted(files):
        remote_path = f"{prefix}/{name}"
        url = signed_download_url(remote_path)
        r = requests.get(url, timeout=180)
        r.raise_for_status()
        with open(os.path.join(tmp_dir, name), "wb") as f:
            f.write(r.content)

    images = [
        f for f in os.listdir(tmp_dir)
        if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
    ]
    image_count = len(images)

    if image_count < MIN_IMAGES or image_count > MAX_IMAGES:
        raise RuntimeError(f"Invalid image count: {image_count} (must be {MIN_IMAGES}-{MAX_IMAGES})")

    repeat, effective_samples, max_train_steps = compute_repeat_and_steps(image_count, batch_size=1)

    repeat_dir_name = f"{repeat}_concept"  # CRITICAL for sd-scripts
    repeat_dir = os.path.join(base_dir, repeat_dir_name)
    os.makedirs(repeat_dir, exist_ok=True)

    for name in sorted(images):
        shutil.move(os.path.join(tmp_dir, name), os.path.join(repeat_dir, name))

    shutil.rmtree(tmp_dir, ignore_errors=True)

    log(f"📊 Images={image_count} → repeat={repeat} → samples≈{effective_samples} → steps={max_train_steps}")

    return {
        "base_dir": base_dir,
        "repeat_dir": repeat_dir,
        "image_count": image_count,
        "repeat": repeat,
        "effective_samples": effective_samples,
        "max_train_steps": max_train_steps,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Training
# ──────────────────────────────────────────────────────────────────────────────
def run_training(job_id: str, ds: Dict[str, Any]) -> str:
    out_dir = os.path.join(OUTPUT_ROOT, f"sf_{job_id}")
    os.makedirs(out_dir, exist_ok=True)

    output_name = f"sf_{job_id}"
    artifact_path = os.path.join(out_dir, f"{output_name}.safetensors")

    cmd = [
        PYTHON_BIN,
        TRAIN_SCRIPT,
        "--pretrained_model_name_or_path", PRETRAINED_MODEL,
        "--vae", VAE_PATH,  # FIXED spacing
        "--train_data_dir", ds["base_dir"],
        "--output_dir", out_dir,
        "--output_name", output_name,
        "--resolution", "1024,1024",
        "--train_batch_size", "1",
        "--learning_rate", "1e-4",
        "--max_train_steps", str(ds["max_train_steps"]),
        "--network_module", NETWORK_MODULE,  # ✅ FIXES your NoneType crash
        "--network_dim", "64",
        "--network_alpha", "32",
        "--mixed_precision", "fp16",
        "--save_model_as", "safetensors",
        "--save_every_n_steps", "200",
    ]

    log("🔥 Starting training")
    log("CMD: " + " ".join(cmd))

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True,
    )

    saw_no_data = False
    saw_ignore_no_repeat = False

    assert proc.stdout is not None
    for line in proc.stdout:
        print(line, end="")
        lower = line.lower()
        if "no data found" in lower or "画像がありません" in line:
            saw_no_data = True
        if "ignore directory without repeats" in lower:
            saw_ignore_no_repeat = True

    rc = proc.wait()

    if saw_no_data:
        raise RuntimeError("sd-scripts reported 'No data found' (dataset structure invalid)")
    if saw_ignore_no_repeat:
        raise RuntimeError("sd-scripts ignored dataset folder (must be '<repeat>_concept')")
    if rc != 0:
        raise RuntimeError(f"Training process failed (exit={rc})")

    if not os.path.exists(artifact_path):
        raise RuntimeError("Training finished but artifact .safetensors not found")

    size = os.path.getsize(artifact_path)
    if size < ARTIFACT_MIN_BYTES:
        raise RuntimeError(f"Artifact exists but is too small ({size} bytes) — treating as failure")

    log(f"✅ Artifact produced: {artifact_path} ({size} bytes)")
    return artifact_path


# ──────────────────────────────────────────────────────────────────────────────
# Claim logic (race-safe)
# ──────────────────────────────────────────────────────────────────────────────
def claim_job(job_id: str) -> bool:
    res = sb_patch_schema_safe(
        "user_loras",
        {"status": "training", "progress": 1, "error_message": None},
        {"id": f"eq.{job_id}", "status": "eq.queued"},
    )
    if isinstance(res, list) and len(res) == 0:
        return False
    return True


# ──────────────────────────────────────────────────────────────────────────────
# Worker loop
# ──────────────────────────────────────────────────────────────────────────────
def worker_main() -> None:
    sanity_checks()
    log("🚀 LoRA worker started (PRODUCTION)")
    log(f"Using PRETRAINED_MODEL={PRETRAINED_MODEL}")
    log(f"Using VAE_PATH={VAE_PATH}")
    log(f"Dataset bucket={STORAGE_BUCKET} prefix={STORAGE_PREFIX}")
    log(f"Local train root={LOCAL_TRAIN_ROOT} output root={OUTPUT_ROOT}")
    log(f"NETWORK_MODULE={NETWORK_MODULE}")

    last_idle = 0

    while True:
        job_id: Optional[str] = None
        try:
            jobs = sb_get("user_loras", {"status": "eq.queued", "order": "created_at.asc", "limit": 1})

            if not jobs:
                if time.time() - last_idle > IDLE_LOG_SECONDS:
                    log("⏳ No queued jobs — waiting")
                    last_idle = time.time()
                time.sleep(POLL_SECONDS)
                continue

            job_id = jobs[0]["id"]
            log(f"📥 Found job {job_id}")

            if not claim_job(job_id):
                log(f"↪️ Job {job_id} was claimed by another worker — skipping")
                time.sleep(1)
                continue

            ds = prepare_dataset(job_id)

            # optional meta fields, schema-safe
            sb_patch_schema_safe(
                "user_loras",
                {
                    "progress": 15,
                    "image_count": ds["image_count"],
                    "repeat": ds["repeat"],
                    "max_train_steps": ds["max_train_steps"],
                },
                {"id": f"eq.{job_id}"},
            )

            artifact_path = run_training(job_id, ds)

            sb_patch_schema_safe(
                "user_loras",
                {
                    "status": "completed",
                    "progress": 100,
                    "artifact_path": artifact_path,
                    "error_message": None,
                },
                {"id": f"eq.{job_id}"},
            )

            log(f"✅ Completed job {job_id}")

        except Exception as e:
            msg = str(e)
            log(f"❌ Job failed: {msg}")

            if job_id:
                try:
                    sb_patch_schema_safe(
                        "user_loras",
                        {"status": "failed", "error_message": msg, "progress": 0},
                        {"id": f"eq.{job_id}"},
                    )
                except Exception as ee:
                    log(f"❌ Failed to mark job failed in Supabase: {ee}")

            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    worker_main()
