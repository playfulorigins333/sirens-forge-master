#!/usr/bin/env python3
"""
SirensForge — SDXL LoRA Trainer (RunPod)

PRODUCTION-SAFE VERSION
- Uses local SDXL checkpoint (.safetensors)
- Uses local VAE (.safetensors)
- Forces bucketing ON for mixed-resolution uploads
- Enforces image count (10–20)
- Correct Supabase enum usage: idle | queued | training | completed | failed
- NO fake completions
"""

import os
import sys
import json
import time
import shlex
import subprocess
from pathlib import Path
from typing import Dict, Any

import requests


# =========================
# Helpers
# =========================

def log(msg: str) -> None:
    print(f"[train_lora] {msg}", flush=True)


def require_env(name: str) -> str:
    v = os.getenv(name)
    if not v or not str(v).strip():
        raise RuntimeError(f"Missing env: {name}")
    return str(v).strip()


def env_int(name: str, default: int) -> int:
    v = os.getenv(name)
    if not v or not str(v).strip():
        return default
    return int(v)


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# =========================
# Supabase Client
# =========================

class SupabaseClient:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/")
        self.key = key

    def patch_user_loras(self, lora_id: str, payload: Dict[str, Any]) -> None:
        r = requests.patch(
            f"{self.url}/rest/v1/user_loras",
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

    def set_status(self, lora_id: str, status: str, extra: Dict[str, Any] | None = None):
        payload = {
            "status": status,
            "updated_at": now_iso(),
        }
        if extra:
            payload.update(extra)
        self.patch_user_loras(lora_id, payload)


# =========================
# Dataset helpers
# =========================

VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

def count_images(path: Path) -> int:
    return sum(
        1 for p in path.rglob("*")
        if p.is_file() and p.suffix.lower() in VALID_EXTS
    )


# =========================
# Training
# =========================

def main() -> int:
    # Required env
    lora_id = require_env("LORA_ID")
    sb_url = require_env("SUPABASE_URL")
    sb_key = require_env("SUPABASE_SERVICE_ROLE_KEY")
    pretrained_model = require_env("PRETRAINED_MODEL")  # local .safetensors
    vae_path = require_env("VAE_PATH")                  # local .safetensors

    sb = SupabaseClient(sb_url, sb_key)

    dataset_dir = Path(f"/workspace/train_data/sf_{lora_id}")
    output_dir = Path("/workspace/output")
    output_dir.mkdir(parents=True, exist_ok=True)

    if not dataset_dir.exists():
        raise RuntimeError(f"Dataset directory missing: {dataset_dir}")

    image_count = count_images(dataset_dir)
    if image_count < 10 or image_count > 20:
        sb.set_status(
            lora_id,
            "failed",
            {"error_message": f"Invalid image count: {image_count} (required 10–20)"},
        )
        raise RuntimeError("Image count gate failed")

    # Transition → training
    sb.set_status(
        lora_id,
        "training",
        {
            "started_at": now_iso(),
            "image_count": image_count,
        },
    )
    log(f"Updated status -> training (images={image_count})")

    train_script = "/workspace/sd-scripts/sdxl_train_network.py"
    if not os.path.exists(train_script):
        raise RuntimeError("sdxl_train_network.py not found")

    output_name = f"lora_{lora_id}"

    cmd = [
        sys.executable,
        train_script,
        "--pretrained_model_name_or_path", pretrained_model,
        "--vae", vae_path,
        "--resolution", "1024,1024",
        "--train_data_dir", str(dataset_dir),
        "--output_dir", str(output_dir),
        "--output_name", output_name,
        "--network_module", "networks.lora",
        "--network_dim", "64",
        "--network_alpha", "64",
        "--learning_rate", "1e-4",
        "--max_train_steps", "1200",
        "--train_batch_size", "1",
        "--mixed_precision", "fp16",
        "--save_model_as", "safetensors",
        "--gradient_checkpointing",

        # 🔑 CRITICAL FIX
        "--enable_bucket",
        "--min_bucket_reso", "256",
        "--max_bucket_reso", "2048",
        "--bucket_reso_steps", "64",

        "--xformers",
    ]

    log("Running: " + " ".join(shlex.quote(c) for c in cmd))

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

    rc = proc.wait()
    if rc != 0:
        sb.set_status(
            lora_id,
            "failed",
            {"error_message": f"Training exited with code {rc}"},
        )
        return rc

    artifact = output_dir / f"{output_name}.safetensors"
    if not artifact.exists():
        sb.set_status(
            lora_id,
            "failed",
            {"error_message": "Training finished but artifact missing"},
        )
        raise RuntimeError("Missing output artifact")

    # ✅ FINAL STATUS (CORRECT ENUM)
    sb.set_status(
        lora_id,
        "completed",
        {
            "completed_at": now_iso(),
        },
    )

    log(f"✅ TRAINING COMPLETE: {artifact}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log(f"❌ ERROR: {e}")
        try:
            if os.getenv("LORA_ID") and os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
                SupabaseClient(
                    os.environ["SUPABASE_URL"],
                    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
                ).set_status(
                    os.environ["LORA_ID"],
                    "failed",
                    {"error_message": str(e)},
                )
        except Exception:
            pass
        raise
