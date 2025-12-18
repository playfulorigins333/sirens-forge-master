#!/usr/bin/env python3
"""
SirensForge - Always-on LoRA Training Worker (PRODUCTION)
OPTION B — STORAGE HANDOFF (REST ONLY)

Flow:
1) Poll Supabase (REST) FIFO for user_loras.status='queued'
2) Atomically claim job -> status='training' (race-safe)
3) Download images from Supabase Storage via signed URLs
4) Build sd-scripts dataset:
     /workspace/train_data/sf_<lora_id>/<repeat>_concept/*.jpg
   IMPORTANT:
     - sd-scripts expects repeats prefix: "<repeat>_<name>" (ex: "120_concept")
     - train_data_dir MUST be the parent folder: /workspace/train_data/sf_<lora_id>
5) Compute repeat + max_train_steps dynamically from image count (~1200 samples)
6) Run sd-scripts
7) HARD FAIL if sd-scripts logs "No data found" even if exit code is 0
8) Verify output artifact exists and is non-trivial size
9) Update Supabase job -> completed / failed (schema-safe patch)
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

# Worker timing
POLL_SECONDS = int(os.getenv("LORA_POLL_SECONDS", "5"))
IDLE_LOG_SECONDS = int(os.getenv("LORA_IDLE_LOG_SECONDS", "30"))

# Production gates
MIN_IMAGES = 10
MAX_IMAGES = 20
TARGET_SAMPLES = 1200
ARTIFACT_MIN_BYTES = int(os.getenv("LORA_ARTIFACT_MIN_BYTES", str(2 * 1024 * 1024)))  # 2MB default

# Optional artifact upload
UPLOAD_ARTIFACTS = os.getenv("LORA_UPLOAD_ARTIFACTS", "false").lower() == "true"
ARTIFACT_BUCKET = os.getenv("LORA_ARTIFACT_BUCKET", "lora-models")
ARTIFACT_PREFIX = os.getenv("LORA_ARTIFACT_PREFIX_ROOT", "lora_models")

# HTTP headers
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
    """
    PostgREST often returns something like:
      {"code":"PGRST204","message":"Could not find the 'repeat' column of 'user_loras' ..."}
    We parse out 'repeat' and allow a retry without that field.
    """
    try:
        data = json.loads(err_text)
        msg = str(data.get("message", ""))
        # Look for: "Could not find the 'XYZ' column"
        marker = "Could not find the '"
        if marker in msg:
            after = msg.split(marker, 1)[1]
            col = after.split("'", 1)[0]
            return col.strip() or None
    except Exception:
        return None
    return None


def sb_patch_schema_safe(table: str, payload: Dict[str, Any], params: Dict[str, Any]) -> Any:
    """
    Production-safe PATCH:
    - If Supabase returns 400 because a column doesn't exist, remove that key and retry.
    - This prevents pipeline breaks from schema drift.
    """
    if not payload:
        return None

    working = dict(payload)
    max_strips = 10  # stop infinite loops

    for _ in range(max_strips):
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

        # Only attempt schema-safe strip on 400
        if r.status_code != 400:
            r.raise_for_status()

        unknown = _extract_unknown_column(r.text or "")
        if not unknown:
            # Not a schema issue we can auto-fix
            r.raise_for_status()

        if unknown in working:
            log(f"⚠️ Supabase schema missing column '{unknown}' — stripping it from PATCH and retrying")
            working.pop(unknown, None)
            continue

        # If we couldn't strip anything meaningful, bail
        r.raise_for_status()

    raise RuntimeError("Supabase PATCH failed after multiple schema-safe retries")


# ──────────────────────────────────────────────────────────────────────────────
# Storage helpers (SIGNED URL + /storage/v1 download)
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
    """
    Supabase returns signedURL as RELATIVE:
      /object/sign/<bucket>/<path>?token=...
    Must download from:
      {SUPABASE_URL}/storage/v1{signedURL}
    """
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

    # In case Supabase ever returns absolute
    if signed.startswith("http") and "/storage/v1/" not in signed:
        return signed.replace(SUPABASE_URL, f"{SUPABASE_URL}/storage/v1", 1)

    return signed


def storage_upload_bytes(bucket: str, path: str, data: bytes, content_type: str) -> None:
    # Storage upload endpoint
    r = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/{bucket}/{path}",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": content_type,
            "x-upsert": "true",
        },
        data=data,
        timeout=60,
    )
    r.raise_for_status()


# ──────────────────────────────────────────────────────────────────────────────
# Repeat/steps logic (LOCKED by your mapping)
# ──────────────────────────────────────────────────────────────────────────────
def compute_repeat_and_steps(image_count: int, batch_size: int = 1) -> Tuple[int, int, int]:
    """
    repeat = round(1200 / image_count)
    effective_samples = image_count * repeat
    max_train_steps = effective_samples / batch_size
    """
    repeat = int(round(TARGET_SAMPLES / float(image_count)))
    repeat = max(1, repeat)
    effective_samples = image_count * repeat
    max_train_steps = int(round(effective_samples / float(batch_size)))
    return repeat, effective_samples, max_train_steps


# ──────────────────────────────────────────────────────────────────────────────
# Dataset handling (sd-scripts compatible)
# ──────────────────────────────────────────────────────────────────────────────
def prepare_dataset(job_id: str) -> Dict[str, Any]:
    """
    Creates:
      base_dir = /workspace/train_data/sf_<job_id>
      repeat_dir = /workspace/train_data/sf_<job_id>/<repeat>_concept
      images into repeat_dir

    Returns dict with:
      base_dir, repeat_dir, image_count, repeat, effective_samples, max_train_steps
    """
    base_dir = os.path.join(LOCAL_TRAIN_ROOT, f"sf_{job_id}")
    shutil.rmtree(base_dir, ignore_errors=True)
    os.makedirs(base_dir, exist_ok=True)

    prefix = f"{STORAGE_PREFIX}/{job_id}"
    objects = list_storage_objects(prefix)
    files = [o.get("name") for o in objects if o.get("name")]

    if not files:
        raise RuntimeError(f"No images found in storage for job {job_id}")

    # Download all files first into a temp dir (stable)
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

    # CRITICAL: sd-scripts expects repeats prefix like "120_concept"
    repeat_dir_name = f"{repeat}_concept"
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
    """
    Runs sd-scripts and returns artifact path.
    HARD FAIL if sd-scripts prints dataset error even with exit code 0.
    """
    out_dir = os.path.join(OUTPUT_ROOT, f"sf_{job_id}")
    os.makedirs(out_dir, exist_ok=True)

    output_name = f"sf_{job_id}"
    artifact_path = os.path.join(out_dir, f"{output_name}.safetensors")

    # NOTE: train_data_dir must be parent of folders with images (ds["base_dir"])
    cmd = [
        PYTHON_BIN,
        TRAIN_SCRIPT,
        "--pretrained_model_name_or_path", PRETRAINED_MODEL,
        "--vae", VAE_PATH,
        "--train_data_dir", ds["base_dir"],
        "--output_dir", out_dir,
        "--output_name", output_name,
        "--resolution", "1024,1024",
        "--train_batch_size", "1",
        "--learning_rate", "1e-4",
        "--max_train_steps", str(ds["max_train_steps"]),
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

    # stream logs
    assert proc.stdout is not None
    for line in proc.stdout:
        print(line, end="")  # keep sd-scripts formatting
        lower = line.lower()
        if "no data found" in lower or "画像がありません" in line:
            saw_no_data = True
        if "ignore directory without repeats" in lower:
            saw_ignore_no_repeat = True

    rc = proc.wait()

    # HARD GATE: even if rc==0, dataset errors must fail
    if saw_no_data:
        raise RuntimeError("sd-scripts reported 'No data found' (dataset structure invalid)")

    # If repeats are still ignored, that means folder naming is wrong
    if saw_ignore_no_repeat:
        raise RuntimeError("sd-scripts ignored dataset folder because repeats were not detected (folder must be '<repeat>_concept')")

    if rc != 0:
        raise RuntimeError(f"Training process failed (exit={rc})")

    # Artifact validation
    if not os.path.exists(artifact_path):
        raise RuntimeError("Training finished but artifact .safetensors not found")
    size = os.path.getsize(artifact_path)
    if size < ARTIFACT_MIN_BYTES:
        raise RuntimeError(f"Artifact exists but is too small ({size} bytes) — treating as failure")

    log(f"✅ Artifact produced: {artifact_path} ({size} bytes)")
    return artifact_path


def maybe_upload_artifact(job_id: str, artifact_path: str) -> Optional[str]:
    """
    Optional: uploads artifact to Supabase Storage and returns storage path.
    Controlled by LORA_UPLOAD_ARTIFACTS=true.
    """
    if not UPLOAD_ARTIFACTS:
        return None

    with open(artifact_path, "rb") as f:
        data = f.read()

    storage_path = f"{ARTIFACT_PREFIX}/{job_id}/lora.safetensors"
    storage_upload_bytes(
        ARTIFACT_BUCKET,
        storage_path,
        data,
        content_type="application/octet-stream",
    )
    log(f"☁️ Uploaded artifact to storage: {ARTIFACT_BUCKET}/{storage_path}")
    return storage_path


# ──────────────────────────────────────────────────────────────────────────────
# Claim logic (race-safe)
# ──────────────────────────────────────────────────────────────────────────────
def claim_job(job_id: str) -> bool:
    """
    Atomically claim by filtering status=eq.queued.
    If nothing is returned, another worker grabbed it.
    """
    res = sb_patch_schema_safe(
        "user_loras",
        {"status": "training", "progress": 1, "error_message": None},
        {"id": f"eq.{job_id}", "status": "eq.queued"},
    )
    # With return=representation, we expect [] if no rows updated
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
    log(f"Upload artifacts={UPLOAD_ARTIFACTS} (bucket={ARTIFACT_BUCKET})")

    last_idle = 0

    while True:
        job_id: Optional[str] = None
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

            if not claim_job(job_id):
                log(f"↪️ Job {job_id} was claimed by another worker — skipping")
                time.sleep(1)
                continue

            # Prepare dataset
            ds = prepare_dataset(job_id)

            # Progress update (schema-safe; won't break if columns don't exist)
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

            # Train
            artifact_path = run_training(job_id, ds)

            # Optional upload
            storage_artifact_path = maybe_upload_artifact(job_id, artifact_path)

            # Completion update (schema-safe)
            sb_patch_schema_safe(
                "user_loras",
                {
                    "status": "completed",
                    "progress": 100,
                    "artifact_path": storage_artifact_path or artifact_path,
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
