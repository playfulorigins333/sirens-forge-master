#!/usr/bin/env python3
"""
SirensForge — SDXL LoRA Trainer (RunPod)

Option A (FINAL BLOCKER FIX):
- Force bucketing ON to support mixed-resolution user uploads.
- Wire env vars into explicit kohya/sd-scripts training args:
  --enable_bucket
  --min_bucket_reso
  --max_bucket_reso

Assumptions (per your verified state):
- sd-scripts / kohya training is installed and working on this pod
- Base model: stabilityai/stable-diffusion-xl-base-1.0
- VAE: madebyollin/sdxl-vae-fp16-fix
- Source of truth table: user_loras
- Job lifecycle queued → training → failed is already correct
"""

from __future__ import annotations

import os
import sys
import json
import time
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Dict, Any

import requests


# =========================
# Config / Environment
# =========================

def _env(name: str, default: Optional[str] = None) -> str:
    v = os.environ.get(name, default)
    if v is None or str(v).strip() == "":
        raise RuntimeError(f"Missing required env var: {name}")
    return str(v).strip()


def _env_int(name: str, default: int) -> int:
    v = os.environ.get(name)
    if v is None or str(v).strip() == "":
        return int(default)
    try:
        return int(str(v).strip())
    except Exception as e:
        raise RuntimeError(f"Env var {name} must be an int. Got: {v}") from e


def _env_float(name: str, default: float) -> float:
    v = os.environ.get(name)
    if v is None or str(v).strip() == "":
        return float(default)
    try:
        return float(str(v).strip())
    except Exception as e:
        raise RuntimeError(f"Env var {name} must be a float. Got: {v}") from e


def _env_bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    if v is None or str(v).strip() == "":
        return bool(default)
    s = str(v).strip().lower()
    if s in ("1", "true", "yes", "y", "on"):
        return True
    if s in ("0", "false", "no", "n", "off"):
        return False
    raise RuntimeError(f"Env var {name} must be a bool-like value. Got: {v}")


def _now_iso() -> str:
    # lightweight ISO-ish without importing datetime timezone complexity
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


@dataclass
class Job:
    lora_id: str
    output_root: Path
    dataset_root: Path
    logs_root: Path


def _resolve_paths(lora_id: str) -> Job:
    # Dataset path is per job (your structure is already correct)
    dataset_root = Path(f"/workspace/train_data/sf_{lora_id}").resolve()
    output_root = Path(f"/workspace/train_output/sf_{lora_id}").resolve()
    logs_root = Path(f"/workspace/train_logs/sf_{lora_id}").resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    logs_root.mkdir(parents=True, exist_ok=True)
    return Job(lora_id=lora_id, output_root=output_root, dataset_root=dataset_root, logs_root=logs_root)


# =========================
# Supabase helpers
# =========================

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

    def set_status(self, lora_id: str, status: str, extra: Optional[Dict[str, Any]] = None) -> None:
        payload: Dict[str, Any] = {
            "status": status,
            "updated_at": _now_iso(),
        }
        if extra:
            payload.update(extra)
        self.patch_user_loras(lora_id, payload)


# =========================
# Dataset validation
# =========================

VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def _count_images(dataset_dir: Path) -> int:
    if not dataset_dir.exists() or not dataset_dir.is_dir():
        raise RuntimeError(f"Dataset directory missing: {dataset_dir}")
    count = 0
    for p in dataset_dir.rglob("*"):
        if p.is_file() and p.suffix.lower() in VALID_EXTS:
            count += 1
    return count


# =========================
# Training invocation
# =========================

def _run(cmd: list[str], log_path: Path) -> int:
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


def _find_sd_scripts_train() -> Path:
    """
    Locate sd-scripts 'train_network.py'.
    You said it's installed and working — we just need a reliable path.
    """
    candidates = [
        Path("/workspace/sd-scripts/train_network.py"),
        Path("/workspace/kohya_ss/sd-scripts/train_network.py"),
        Path("/workspace/kohya/sd-scripts/train_network.py"),
        Path("/workspace/sd_scripts/train_network.py"),
    ]
    for c in candidates:
        if c.exists():
            return c.resolve()
    raise RuntimeError(
        "Could not find train_network.py. Expected under /workspace (sd-scripts/kohya)."
    )


def _build_training_command(job: Job) -> tuple[list[str], Path]:
    """
    Builds a kohya/sd-scripts SDXL LoRA training command.

    BLOCKER FIX:
    - Forces bucketing ON and wires min/max bucket reso explicitly.
    """
    train_py = _find_sd_scripts_train()
    python_bin = sys.executable

    # Required (verified)
    pretrained_model = os.environ.get("BASE_MODEL", "stabilityai/stable-diffusion-xl-base-1.0").strip()
    vae_model = os.environ.get("VAE_MODEL", "madebyollin/sdxl-vae-fp16-fix").strip()

    # Core training knobs (use your existing env defaults if present)
    resolution = _env_int("RESOLUTION", 1024)  # SDXL common
    batch_size = _env_int("TRAIN_BATCH_SIZE", 1)
    max_train_epochs = _env_int("MAX_TRAIN_EPOCHS", 1)
    max_train_steps = _env_int("MAX_TRAIN_STEPS", 0)  # if 0, sd-scripts uses epochs
    learning_rate = _env_float("LEARNING_RATE", 1e-4)
    network_dim = _env_int("NETWORK_DIM", 16)
    network_alpha = _env_int("NETWORK_ALPHA", 16)
    seed = _env_int("SEED", 42)

    # Output naming
    output_name = os.environ.get("OUTPUT_NAME", f"sf_{job.lora_id}").strip()

    # ====== BUCKETING (FORCED ON) ======
    # Explicitly wired env vars → args
    min_bucket_reso = _env_int("MIN_BUCKET_RESO", 256)
    max_bucket_reso = _env_int("MAX_BUCKET_RESO", 2048)

    # Safety: ensure reasonable relationship
    if min_bucket_reso < 64:
        raise RuntimeError(f"MIN_BUCKET_RESO too small: {min_bucket_reso}")
    if max_bucket_reso < min_bucket_reso:
        raise RuntimeError(f"MAX_BUCKET_RESO ({max_bucket_reso}) < MIN_BUCKET_RESO ({min_bucket_reso})")
    if max_bucket_reso > 4096:
        raise RuntimeError(f"MAX_BUCKET_RESO too large: {max_bucket_reso}")

    # If you want to still support turning off in future, keep env but OVERRIDE to ON per your rule.
    enable_bucket_forced = True

    # Other common SDXL sd-scripts flags
    mixed_precision = os.environ.get("MIXED_PRECISION", "fp16").strip()
    save_precision = os.environ.get("SAVE_PRECISION", "fp16").strip()
    optimizer_type = os.environ.get("OPTIMIZER_TYPE", "AdamW8bit").strip()
    lr_scheduler = os.environ.get("LR_SCHEDULER", "cosine").strip()
    lr_warmup_steps = _env_int("LR_WARMUP_STEPS", 0)

    # Captions / dataset configuration
    caption_ext = os.environ.get("CAPTION_EXTENSION", ".txt").strip()
    shuffle_caption = _env_bool("SHUFFLE_CAPTION", True)
    keep_tokens = _env_int("KEEP_TOKENS", 0)

    # Logging / save frequency
    save_every_n_epochs = _env_int("SAVE_EVERY_N_EPOCHS", 1)
    save_last_n_epochs = _env_int("SAVE_LAST_N_EPOCHS", 1)

    # Optional cache latents
    cache_latents = _env_bool("CACHE_LATENTS", True)

    # Build command
    cmd: list[str] = [
        python_bin,
        str(train_py),
        "--pretrained_model_name_or_path", pretrained_model,
        "--train_data_dir", str(job.dataset_root),
        "--output_dir", str(job.output_root),
        "--output_name", output_name,
        "--resolution", str(resolution),
        "--train_batch_size", str(batch_size),
        "--learning_rate", str(learning_rate),
        "--network_dim", str(network_dim),
        "--network_alpha", str(network_alpha),
        "--seed", str(seed),
        "--mixed_precision", mixed_precision,
        "--save_precision", save_precision,
        "--optimizer_type", optimizer_type,
        "--lr_scheduler", lr_scheduler,
        "--caption_extension", caption_ext,
        "--max_train_epochs", str(max_train_epochs),
        "--save_every_n_epochs", str(save_every_n_epochs),
        "--save_last_n_epochs", str(save_last_n_epochs),
        "--sdxl",
        "--vae", vae_model,
    ]

    # max steps override if provided
    if max_train_steps and max_train_steps > 0:
        cmd += ["--max_train_steps", str(max_train_steps)]
    if lr_warmup_steps and lr_warmup_steps > 0:
        cmd += ["--lr_warmup_steps", str(lr_warmup_steps)]

    # Caption handling
    if shuffle_caption:
        cmd.append("--shuffle_caption")
    if keep_tokens and keep_tokens > 0:
        cmd += ["--keep_tokens", str(keep_tokens)]

    # Cache latents
    if cache_latents:
        cmd.append("--cache_latents")

    # ====== FORCE BUCKETING FLAGS (YOUR REQUEST) ======
    if enable_bucket_forced:
        cmd.append("--enable_bucket")
        cmd += ["--min_bucket_reso", str(min_bucket_reso)]
        cmd += ["--max_bucket_reso", str(max_bucket_reso)]

    # IMPORTANT:
    # We do NOT enable random_crop here. Bucketing is the intended fix for mixed resolutions.
    # If you later choose to add cropping, do it intentionally (not as a side-effect).

    log_path = job.logs_root / "train.log"
    return cmd, log_path


def _validate_artifacts(job: Job) -> Path:
    """
    Hard validation: training is only "complete" if a LoRA file exists.
    Accept common extensions produced by sd-scripts.
    """
    candidates = []
    for ext in (".safetensors", ".pt", ".ckpt"):
        candidates.extend(job.output_root.glob(f"*.{ext.lstrip('.')}"))
    # Prefer safetensors if present
    safes = [p for p in candidates if p.suffix.lower() == ".safetensors"]
    if safes:
        return max(safes, key=lambda p: p.stat().st_mtime)

    if candidates:
        return max(candidates, key=lambda p: p.stat().st_mtime)

    raise RuntimeError(f"No LoRA artifact found in output_dir: {job.output_root}")


# =========================
# Main
# =========================

def main() -> int:
    # Required identifiers
    lora_id = _env("LORA_ID")

    # Supabase (already verified working, we keep it strict)
    sb_url = _env("SUPABASE_URL")
    sb_key = _env("SUPABASE_SERVICE_ROLE_KEY")
    sb = SupabaseClient(sb_url, sb_key)

    job = _resolve_paths(lora_id)

    # Dataset existence + count gate (kept lightweight and strict)
    img_count = _count_images(job.dataset_root)
    min_images = _env_int("MIN_IMAGES", 10)
    max_images = _env_int("MAX_IMAGES", 20)
    if img_count < min_images or img_count > max_images:
        sb.set_status(
            lora_id,
            "failed",
            {
                "error": f"Invalid image count: {img_count}. Required {min_images}-{max_images}.",
            },
        )
        raise RuntimeError(f"Image count gate failed: {img_count} images in {job.dataset_root}")

    # Move to training
    sb.set_status(
        lora_id,
        "training",
        {
            "started_at": _now_iso(),
            "train_data_dir": str(job.dataset_root),
            "output_dir": str(job.output_root),
            "log_dir": str(job.logs_root),
            "image_count": img_count,
        },
    )

    # Build + run training command (BUCKETING FORCED ON HERE)
    cmd, log_path = _build_training_command(job)

    # Store the exact args for traceability
    try:
        sb.patch_user_loras(
            lora_id,
            {
                "train_args": json.dumps(cmd),
                "bucket_enabled": True,
                "min_bucket_reso": _env_int("MIN_BUCKET_RESO", 256),
                "max_bucket_reso": _env_int("MAX_BUCKET_RESO", 2048),
                "updated_at": _now_iso(),
            },
        )
    except Exception:
        # Do not fail training for metadata issues
        pass

    rc = _run(cmd, log_path)

    if rc != 0:
        # Training failed
        sb.set_status(
            lora_id,
            "failed",
            {
                "finished_at": _now_iso(),
                "error": f"Training process exited non-zero (code={rc}). See log: {log_path}",
            },
        )
        return rc

    # Artifact validation (NO FAKE COMPLETIONS)
    artifact_path = _validate_artifacts(job)

    # Complete
    sb.set_status(
        lora_id,
        "complete",
        {
            "finished_at": _now_iso(),
            "artifact_path": str(artifact_path),
            "log_path": str(log_path),
        },
    )

    print(f"\n✅ TRAINING COMPLETE\nArtifact: {artifact_path}\nLog: {log_path}\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        # Best-effort: mark failed if we have enough env to do so
        try:
            lora_id = os.environ.get("LORA_ID", "").strip()
            sb_url = os.environ.get("SUPABASE_URL", "").strip()
            sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
            if lora_id and sb_url and sb_key:
                SupabaseClient(sb_url, sb_key).set_status(
                    lora_id,
                    "failed",
                    {
                        "finished_at": _now_iso(),
                        "error": str(e),
                    },
                )
        except Exception:
            pass
        print(f"\n❌ ERROR: {e}\n", file=sys.stderr)
        raise
