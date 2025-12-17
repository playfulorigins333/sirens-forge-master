#!/usr/bin/env python3
"""
SirensForge — SDXL LoRA Trainer (RunPod) — PRODUCTION LAUNCH SAFE

FULL FILE REPLACEMENT.

Key fixes:
- FORCE BUCKETING ON (mixed user image resolutions will not crash)
- Per-job dataset dir: /workspace/train_data/sf_<LORA_ID>/
- Hard gate: 10–20 images
- Strict Supabase status transitions with SAFE columns only:
  status, error_message, updated_at
  (DO NOT write finished_at / artifact_path — those columns do not exist in your DB)
- Validate artifact exists before marking complete

Required env vars:
- LORA_ID
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- PRETRAINED_MODEL   (path to SDXL checkpoint .safetensors)
- VAE_PATH           (path to VAE .safetensors)
"""

from __future__ import annotations

import os
import sys
import time
import json
import shlex
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional, List

import requests


# -------------------------
# Helpers
# -------------------------

def log(msg: str) -> None:
    print(f"[train_lora] {msg}", flush=True)


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def require_env(name: str) -> str:
    v = os.getenv(name)
    if not v or not str(v).strip():
        raise RuntimeError(f"Missing env: {name}")
    return str(v).strip()


def env_int(name: str, default: int) -> int:
    v = os.getenv(name)
    if v is None or str(v).strip() == "":
        return default
    return int(str(v).strip())


def env_bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v is None or str(v).strip() == "":
        return default
    s = str(v).strip().lower()
    if s in ("1", "true", "yes", "y", "on"):
        return True
    if s in ("0", "false", "no", "n", "off"):
        return False
    raise RuntimeError(f"Env var {name} must be bool-like. Got: {v}")


# -------------------------
# Supabase client (SAFE columns only)
# -------------------------

class SupabaseClient:
    def __init__(self, url: str, service_role_key: str):
        self.base = url.rstrip("/")
        self.key = service_role_key

    def patch_user_loras(self, lora_id: str, payload: Dict[str, Any]) -> None:
        endpoint = f"{self.base}/rest/v1/user_loras"
        r = requests.patch(
            endpoint,
            params={"id": f"eq.{lora_id}"},
            headers={
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            json=payload,
            timeout=30,
        )
        if r.status_code >= 300:
            raise RuntimeError(f"Supabase PATCH failed: {r.status_code} {r.text}")

    def set_status(self, lora_id: str, status: str, error_message: Optional[str] = None) -> None:
        # IMPORTANT: only write columns we know exist
        payload: Dict[str, Any] = {
            "status": status,
            "updated_at": now_iso(),
        }
        if error_message is not None:
            payload["error_message"] = error_message
        self.patch_user_loras(lora_id, payload)


# -------------------------
# Dataset validation
# -------------------------

VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def dataset_root_for(lora_id: str) -> Path:
    return Path(f"/workspace/train_data/sf_{lora_id}").resolve()


def count_images(root: Path) -> int:
    if not root.exists() or not root.is_dir():
        raise RuntimeError(f"Dataset directory missing: {root}")
    n = 0
    for p in root.rglob("*"):
        if p.is_file() and p.suffix.lower() in VALID_EXTS:
            n += 1
    return n


# -------------------------
# Training command builder
# -------------------------

def training_script_path() -> Path:
    # You proved this exists:
    p = Path("/workspace/sd-scripts/sdxl_train_network.py")
    if p.exists():
        return p.resolve()
    raise RuntimeError("Missing training script at /workspace/sd-scripts/sdxl_train_network.py")


def build_cmd(lora_id: str, train_data_dir: Path, output_dir: Path) -> List[str]:
    python_bin = sys.executable
    train_py = training_script_path()

    pretrained_model = require_env("PRETRAINED_MODEL")
    vae_path = require_env("VAE_PATH")

    # Hard defaults for launch
    resolution = env_int("RESOLUTION", 1024)  # used as 1024,1024
    batch_size = env_int("TRAIN_BATCH_SIZE", 1)
    max_train_steps = env_int("MAX_TRAIN_STEPS", 1200)
    learning_rate = os.getenv("LEARNING_RATE", "1e-4").strip() or "1e-4"
    network_dim = env_int("NETWORK_DIM", 64)
    network_alpha = env_int("NETWORK_ALPHA", 64)

    mixed_precision = os.getenv("MIXED_PRECISION", "fp16").strip() or "fp16"
    use_xformers = env_bool("USE_XFORMERS", True)

    # BUCKETING (FORCED ON)
    min_bucket_reso = env_int("MIN_BUCKET_RESO", 256)
    max_bucket_reso = env_int("MAX_BUCKET_RESO", 2048)
    bucket_reso_steps = env_int("BUCKET_RESO_STEPS", 64)

    if max_bucket_reso < min_bucket_reso:
        raise RuntimeError(f"MAX_BUCKET_RESO ({max_bucket_reso}) < MIN_BUCKET_RESO ({min_bucket_reso})")

    output_name = f"lora_{lora_id}"

    cmd: List[str] = [
        python_bin,
        str(train_py),

        "--pretrained_model_name_or_path", pretrained_model,
        "--vae", vae_path,

        "--resolution", f"{resolution},{resolution}",
        "--train_data_dir", str(train_data_dir),

        "--output_dir", str(output_dir),
        "--output_name", output_name,

        "--network_module", "networks.lora",
        "--network_dim", str(network_dim),
        "--network_alpha", str(network_alpha),

        "--learning_rate", str(learning_rate),
        "--max_train_steps", str(max_train_steps),
        "--train_batch_size", str(batch_size),

        "--mixed_precision", mixed_precision,
        "--save_model_as", "safetensors",
        "--gradient_checkpointing",

        # ✅ FORCE BUCKETING ON
        "--enable_bucket",
        "--min_bucket_reso", str(min_bucket_reso),
        "--max_bucket_reso", str(max_bucket_reso),
        "--bucket_reso_steps", str(bucket_reso_steps),
    ]

    if use_xformers:
        cmd.append("--xformers")

    return cmd


def run_and_log(cmd: List[str], log_path: Path) -> int:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("w", encoding="utf-8") as f:
        f.write("CMD:\n")
        f.write(" ".join(shlex.quote(c) for c in cmd) + "\n\n")
        f.flush()

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            sys.stdout.write(line)
            f.write(line)
        return proc.wait()


def expected_artifact(output_dir: Path, lora_id: str) -> Path:
    return output_dir / f"lora_{lora_id}.safetensors"


# -------------------------
# Main
# -------------------------

def main() -> int:
    lora_id = require_env("LORA_ID")
    sb_url = require_env("SUPABASE_URL")
    sb_key = require_env("SUPABASE_SERVICE_ROLE_KEY")

    sb = SupabaseClient(sb_url, sb_key)

    # Per-job dirs
    train_data_dir = dataset_root_for(lora_id)
    output_dir = Path("/workspace/output").resolve()
    logs_dir = Path(f"/workspace/train_logs/sf_{lora_id}").resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)

    # Hard gate: image count 10–20
    img_count = count_images(train_data_dir)
    min_images = env_int("MIN_IMAGES", 10)
    max_images = env_int("MAX_IMAGES", 20)
    if img_count < min_images or img_count > max_images:
        msg = f"Invalid image count: {img_count}. Required {min_images}-{max_images}."
        log(msg)
        sb.set_status(lora_id, "failed", msg)
        raise RuntimeError(msg)

    # Move to training
    sb.set_status(lora_id, "training", None)
    log(f"Updated status -> training (images={img_count}, steps≈{env_int('MAX_TRAIN_STEPS', 1200)})")
    log(f"Resolved train_data_dir: {train_data_dir}")

    # Build command (bucket forced on)
    cmd = build_cmd(lora_id, train_data_dir, output_dir)
    log_path = logs_dir / "train.log"

    # Best-effort store train_args if the column exists (ignore if not)
    try:
        sb.patch_user_loras(lora_id, {
            "updated_at": now_iso(),
            "error_message": None,
            "train_args": json.dumps(cmd),
        })
    except Exception:
        pass

    log("Running: " + " ".join(shlex.quote(c) for c in cmd))
    t0 = time.time()
    rc = run_and_log(cmd, log_path)
    dt = time.time() - t0

    if rc != 0:
        msg = f"Training failed with exit code {rc} after {dt:.1f}s (see {log_path})"
        log("ERROR: " + msg)
        sb.set_status(lora_id, "failed", msg)
        return rc

    # Validate artifact exists before marking complete
    artifact = expected_artifact(output_dir, lora_id)
    if not artifact.exists() or artifact.stat().st_size < 1024 * 1024:
        msg = f"Training exited 0 but artifact missing/too small: {artifact}"
        log("ERROR: " + msg)
        sb.set_status(lora_id, "failed", msg)
        raise RuntimeError(msg)

    sb.set_status(lora_id, "complete", None)
    log(f"✅ TRAINING COMPLETE: {artifact}")
    log(f"Log: {log_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        # Best-effort mark failed
        try:
            lora_id = os.getenv("LORA_ID", "").strip()
            sb_url = os.getenv("SUPABASE_URL", "").strip()
            sb_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
            if lora_id and sb_url and sb_key:
                SupabaseClient(sb_url, sb_key).set_status(lora_id, "failed", str(e))
        except Exception:
            pass
        print(f"\n❌ ERROR: {e}\n", file=sys.stderr)
        raise
