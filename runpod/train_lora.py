#!/usr/bin/env python3
"""
SirensForge - Always-on LoRA Training Worker (OPTION B: Storage Handoff)

Flow:
1) Poll Supabase `user_loras` FIFO for status='queued'
2) Atomically claim job -> status='training'
3) Download dataset images from Supabase Storage:
     bucket: lora-datasets
     prefix: lora_datasets/<lora_id>/
4) Build local dataset dir:
     /workspace/train_data/sf_<lora_id>/
5) Run sd-scripts training
6) Update row -> completed/failed (+ progress)
"""

import os
import sys
import time
import json
import shutil
import subprocess
from dataclasses import dataclass
from typing import Optional, List, Dict, Any

import requests

try:
    from supabase import create_client
except Exception as e:
    print("[train_lora_worker] ❌ Missing dependency: supabase-py not installed in this environment.")
    print("Install on the worker pod:")
    print("  pip install supabase")
    raise


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
@dataclass
class Config:
    supabase_url: str
    supabase_service_role_key: str

    pretrained_model: str
    vae_path: str

    storage_bucket: str
    storage_prefix_root: str

    poll_seconds: int
    idle_log_seconds: int

    local_train_root: str
    output_root: str

    train_script: str
    python_bin: str

    # Training hyperparams (defaults are sane, override via env)
    resolution: str
    steps: int
    batch_size: int
    learning_rate: str
    network_dim: int
    network_alpha: int
    max_train_epochs: int


def load_config() -> Config:
    # Required env
    supabase_url = require_env("SUPABASE_URL")
    supabase_service_role_key = require_env("SUPABASE_SERVICE_ROLE_KEY")
    pretrained_model = require_env("PRETRAINED_MODEL")
    vae_path = require_env("VAE_PATH")

    # Validate files exist
    if not os.path.exists(pretrained_model):
        raise RuntimeError(f"PRETRAINED_MODEL not found: {pretrained_model}")
    if not os.path.exists(vae_path):
        raise RuntimeError(f"VAE_PATH not found: {vae_path}")

    return Config(
        supabase_url=supabase_url,
        supabase_service_role_key=supabase_service_role_key,
        pretrained_model=pretrained_model,
        vae_path=vae_path,

        storage_bucket=os.getenv("LORA_DATASET_BUCKET", "lora-datasets"),
        storage_prefix_root=os.getenv("LORA_DATASET_PREFIX_ROOT", "lora_datasets"),

        poll_seconds=int(os.getenv("LORA_POLL_SECONDS", "5")),
        idle_log_seconds=int(os.getenv("LORA_IDLE_LOG_SECONDS", "30")),

        local_train_root=os.getenv("LORA_LOCAL_TRAIN_ROOT", "/workspace/train_data"),
        output_root=os.getenv("LORA_OUTPUT_ROOT", "/workspace/output_loras"),

        train_script=os.getenv("TRAIN_SCRIPT", "/workspace/sd-scripts/sdxl_train_network.py"),
        python_bin=os.getenv("PYTHON_BIN", sys.executable),

        resolution=os.getenv("LORA_RESOLUTION", "1024,1024"),
        steps=int(os.getenv("LORA_TRAIN_STEPS", "1200")),
        batch_size=int(os.getenv("LORA_BATCH_SIZE", "1")),
        learning_rate=os.getenv("LORA_LEARNING_RATE", "1e-4"),
        network_dim=int(os.getenv("LORA_NETWORK_DIM", "64")),
        network_alpha=int(os.getenv("LORA_NETWORK_ALPHA", "32")),
        max_train_epochs=int(os.getenv("LORA_MAX_EPOCHS", "1")),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Supabase helpers
# ──────────────────────────────────────────────────────────────────────────────
class Supa:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.client = create_client(cfg.supabase_url, cfg.supabase_service_role_key)

    def fetch_next_queued_job(self) -> Optional[Dict[str, Any]]:
        # FIFO: oldest created_at first
        resp = (
            self.client.table("user_loras")
            .select("id,status,created_at,image_count")
            .eq("status", "queued")
            .order("created_at", desc=False)
            .limit(1)
            .execute()
        )
        data = resp.data or []
        if not data:
            return None
        return data[0]

    def claim_job(self, job_id: str) -> bool:
        # Atomic-ish claim: update only if status is still queued
        resp = (
            self.client.table("user_loras")
            .update({"status": "training", "progress": 1, "error_message": None})
            .eq("id", job_id)
            .eq("status", "queued")
            .execute()
        )
        # If row wasn't queued anymore, update won't apply.
        # supabase-py returns data array of updated rows
        return bool(resp.data)

    def set_failed(self, job_id: str, msg: str) -> None:
        _ = (
            self.client.table("user_loras")
            .update({"status": "failed", "error_message": msg, "progress": 0})
            .eq("id", job_id)
            .execute()
        )

    def set_progress(self, job_id: str, p: int) -> None:
        p = max(0, min(100, int(p)))
        _ = (
            self.client.table("user_loras")
            .update({"progress": p})
            .eq("id", job_id)
            .execute()
        )

    def set_completed(self, job_id: str) -> None:
        _ = (
            self.client.table("user_loras")
            .update({"status": "completed", "progress": 100, "error_message": None})
            .eq("id", job_id)
            .execute()
        )

    # Storage methods
    def list_storage_objects(self, bucket: str, prefix: str) -> List[Dict[str, Any]]:
        # supabase storage list expects path relative to bucket root
        # prefix like "lora_datasets/<id>"
        resp = self.client.storage.from_(bucket).list(path=prefix)
        return resp or []

    def signed_url(self, bucket: str, path_in_bucket: str, expires_in: int = 3600) -> str:
        # returns dict { signedURL: "...", path: "..." }
        resp = self.client.storage.from_(bucket).create_signed_url(path_in_bucket, expires_in)
        if not resp or "signedURL" not in resp:
            raise RuntimeError("Failed to create signed URL for storage object")
        return resp["signedURL"]


# ──────────────────────────────────────────────────────────────────────────────
# Dataset download
# ──────────────────────────────────────────────────────────────────────────────
def ensure_dir(p: str) -> None:
    os.makedirs(p, exist_ok=True)


def clear_dir(p: str) -> None:
    if os.path.exists(p):
        shutil.rmtree(p)
    os.makedirs(p, exist_ok=True)


def download_dataset_from_storage(
    supa: Supa,
    cfg: Config,
    job_id: str,
) -> str:
    """
    Downloads storage objects from:
      bucket: cfg.storage_bucket
      prefix: cfg.storage_prefix_root/<job_id>/
    into:
      /workspace/train_data/sf_<job_id>/
    Returns local dataset dir.
    """
    local_dir = os.path.join(cfg.local_train_root, f"sf_{job_id}")
    clear_dir(local_dir)

    prefix = f"{cfg.storage_prefix_root}/{job_id}"
    objects = supa.list_storage_objects(cfg.storage_bucket, prefix)

    # storage list returns only objects in that directory. We expect img_*.jpg
    files = [o for o in objects if o.get("name") and not o.get("name", "").endswith("/")]
    if not files:
        raise RuntimeError(f"No files found in storage at {cfg.storage_bucket}/{prefix}")

    # Download each file
    # Objects come back with fields like: name, id, updated_at, etc.
    # name is just filename, so full path is f"{prefix}/{name}"
    for o in sorted(files, key=lambda x: x.get("name", "")):
        name = o["name"]
        storage_path = f"{prefix}/{name}"
        url = supa.signed_url(cfg.storage_bucket, storage_path, expires_in=3600)

        r = requests.get(url, timeout=120)
        if r.status_code != 200:
            raise RuntimeError(f"Failed download {storage_path} (status {r.status_code})")

        out_path = os.path.join(local_dir, name)
        with open(out_path, "wb") as f:
            f.write(r.content)

    # Verify image count 10–20
    local_files = [fn for fn in os.listdir(local_dir) if fn.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))]
    if len(local_files) < 10 or len(local_files) > 20:
        raise RuntimeError(f"Invalid image count after download: {len(local_files)} (expected 10–20)")

    return local_dir


# ──────────────────────────────────────────────────────────────────────────────
# Training launch
# ──────────────────────────────────────────────────────────────────────────────
def run_training(cfg: Config, job_id: str, dataset_dir: str) -> None:
    """
    Minimal sd-scripts launch. Customize via env if needed.
    Writes outputs to /workspace/output_loras/sf_<job_id>/
    """
    ensure_dir(cfg.output_root)
    out_dir = os.path.join(cfg.output_root, f"sf_{job_id}")
    ensure_dir(out_dir)

    if not os.path.exists(cfg.train_script):
        raise RuntimeError(f"Train script not found: {cfg.train_script}")

    # NOTE: These args are conservative and should run.
    # If your sd-scripts setup expects different flags, set TRAIN_SCRIPT and override env vars.
    cmd = [
        cfg.python_bin,
        cfg.train_script,
        "--pretrained_model_name_or_path", cfg.pretrained_model,
        "--vae", cfg.vae_path,
        "--train_data_dir", dataset_dir,
        "--output_dir", out_dir,
        "--output_name", f"sf_{job_id}",
        "--resolution", cfg.resolution,
        "--train_batch_size", str(cfg.batch_size),
        "--learning_rate", cfg.learning_rate,
        "--max_train_steps", str(cfg.steps),
        "--network_dim", str(cfg.network_dim),
        "--network_alpha", str(cfg.network_alpha),
        "--max_train_epochs", str(cfg.max_train_epochs),
        "--save_model_as", "safetensors",
        "--mixed_precision", "fp16",
        "--save_precision", "fp16",
    ]

    log("🔥 Launching sd-scripts training")
    log("CMD: " + " ".join(cmd))

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    assert proc.stdout is not None
    for line in proc.stdout:
        # Stream logs to console
        sys.stdout.write(line)
        sys.stdout.flush()

    rc = proc.wait()
    if rc != 0:
        raise RuntimeError(f"Training exited with code {rc}")


# ──────────────────────────────────────────────────────────────────────────────
# Worker main loop
# ──────────────────────────────────────────────────────────────────────────────
def worker_main() -> int:
    cfg = load_config()
    supa = Supa(cfg)

    log("🚀 LoRA worker started (always-on, fifo, storage-handoff)")
    log(f"Polling every {cfg.poll_seconds}s | idle log every {cfg.idle_log_seconds}s")
    log(f"Using PRETRAINED_MODEL={cfg.pretrained_model}")
    log(f"Using VAE_PATH={cfg.vae_path}")
    log(f"Storage bucket={cfg.storage_bucket} prefix_root={cfg.storage_prefix_root}")
    log(f"Local dataset root={cfg.local_train_root}")
    log(f"Train script={cfg.train_script}")

    last_idle = 0.0

    while True:
        try:
            job = supa.fetch_next_queued_job()
            if not job:
                now = time.time()
                if now - last_idle >= cfg.idle_log_seconds:
                    log("⏳ No queued jobs — waiting")
                    last_idle = now
                time.sleep(cfg.poll_seconds)
                continue

            job_id = str(job["id"])
            created_at = job.get("created_at")
            log(f"📥 Found queued job: {job_id} (created_at={created_at})")

            if not supa.claim_job(job_id):
                log(f"⚠️ Could not claim job (already claimed): {job_id}")
                time.sleep(1)
                continue

            log(f"✅ Claimed job -> training: {job_id}")

            # Step 1: Download dataset from storage
            supa.set_progress(job_id, 3)
            log("📦 Downloading dataset from Supabase Storage...")
            dataset_dir = download_dataset_from_storage(supa, cfg, job_id)
            supa.set_progress(job_id, 10)
            log(f"📂 Dataset ready: {dataset_dir}")

            # Step 2: Run training
            supa.set_progress(job_id, 15)
            run_training(cfg, job_id, dataset_dir)

            # Step 3: Mark completed
            supa.set_completed(job_id)
            log(f"✅ Completed job: {job_id}")

        except KeyboardInterrupt:
            log("🛑 Worker stopped by user")
            return 0
        except Exception as e:
            # If we know the job_id in scope, mark failed
            msg = str(e)
            try:
                if "job_id" in locals():
                    supa.set_failed(job_id, msg)
                    log(f"❌ Failed job {job_id}: {msg}")
                else:
                    log(f"❌ Worker error (no job context): {msg}")
            except Exception as ee:
                log(f"❌ Failed to mark job failed: {ee}")
            time.sleep(cfg.poll_seconds)


if __name__ == "__main__":
    try:
        sys.exit(worker_main())
    except Exception as e:
        log(f"❌ FATAL ERROR: {e}")
        raise
