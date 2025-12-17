#!/usr/bin/env python3
"""
SirensForge — SDXL LoRA Trainer (RunPod) — PRODUCTION-SAFE (Launch)

This script is designed to run on the RunPod trainer pod and pull a single LoRA job
from Supabase (user_loras) by LORA_ID, validate the dataset, and run kohya/sd-scripts.

CRITICAL FIX:
- We run /workspace/sd-scripts/sdxl_train_network.py (your pod has it)
- We FORCE bucketing ON via:
    --enable_bucket
    --min_bucket_reso
    --max_bucket_reso

Why:
- Real customer uploads are mixed resolution (yours were 1024x962 and 1056x992)
- Without bucket/crop, kohya asserts and crashes:
    "image too large, but cropping and bucketing are disabled"

Hard rules enforced:
- Dataset must exist at: /workspace/train_data/sf_<LORA_ID>/
- Valid images: 10–20 (hard gate)
- Job must start in status 'queued' (hard gate)
- NO fake completions: we only mark complete if a .safetensors artifact exists

Supabase schema safety:
- We ONLY write columns we can safely assume exist:
    status, error_message, updated_at
- We DO NOT write: finished_at, artifact_path, started_at, etc.
"""

from __future__ import annotations

import os
import sys
import time
import shlex
import json
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional, List

import requests


# =========================
# Small helpers
# =========================

def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _require_env(name: str) -> str:
    v = os.environ.get(name, "").strip()
    if not v:
        raise RuntimeError(f"Missing env: {name}")
    return v


def _env_int(name: str, default: int) -> int:
    v = os.environ.get(name, "").strip()
    if not v:
        return int(default)
    try:
        return int(v)
    except Exception as e:
        raise RuntimeError(f"Env var {name} must be an int. Got: {v}") from e


def _env_float(name: str, default: float) -> float:
    v = os.environ.get(name, "").strip()
    if not v:
        return float(default)
    try:
        return float(v)
    except Exception as e:
        raise RuntimeError(f"Env var {name} must be a float. Got: {v}") from e


def _log(msg: str) -> None:
    print(f"[train_lora] {msg}", flush=True)


# =========================
# Supabase client (REST)
# =========================

class SupabaseClient:
    def __init__(self, url: str, service_role_key: str):
        self.base = url.rstrip("/")
        self.key = service_role_key

    def _headers(self) -> Dict[str, str]:
        return {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }

    def get_job(self, lora_id: str) -> Dict[str, Any]:
        endpoint = f"{self.base}/rest/v1/user_loras"
        # Keep select minimal so we don't depend on extra columns.
        params = {
            "id": f"eq.{lora_id}",
            "select": "id,user_id,status,name",
            "limit": "1",
        }
        r = requests.get(endpoint, params=params, headers=self._headers(), timeout=30)
        if r.status_code >= 300:
            raise RuntimeError(f"Supabase GET failed: {r.status_code} {r.text}")
        data = r.json()
        if not data:
            raise RuntimeError(f"Job not found in user_loras: {lora_id}")
        return data[0]

    def patch_job(self, lora_id: str, payload: Dict[str, Any]) -> None:
        endpoint = f"{self.base}/rest/v1/user_loras"
        params = {"id": f"eq.{lora_id}"}
        headers = dict(self._headers())
        headers["Prefer"] = "return=minimal"
        r = requests.patch(endpoint, params=params, headers=headers, json=payload, timeout=30)
        if r.status_code >= 300:
            raise RuntimeError(f"Supabase PATCH failed: {r.status_code} {r.text}")

    def set_status(self, lora_id: str, status: str, error_message: Optional[str] = None) -> None:
        # ONLY columns we rely on existing:
        payload: Dict[str, Any] = {
            "status": status,
            "updated_at": _now_iso(),
        }
        # Your SQL reset uses error_message, so we use that exact column name.
        if error_message is not None:
            payload["error_message"] = error_message
        self.patch_job(lora_id, payload)


# =========================
# Dataset validation
# =========================

VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def _resolve_dataset_dir(lora_id: str) -> Path:
    # REQUIRED structure
    return Path(f"/workspace/train_data/sf_{lora_id}").resolve()


def _count_valid_images(dataset_root: Path) -> int:
    if not dataset_root.exists() or not dataset_root.is_dir():
        raise RuntimeError(f"Dataset directory does not exist: {dataset_root}")
    count = 0
    for p in dataset_root.rglob("*"):
        if p.is_file() and p.suffix.lower() in VALID_EXTS:
            count += 1
    return count


# =========================
# Training invocation
# =========================

def _training_script_path() -> Path:
    # Your pod has this exact file.
    p = Path(os.environ.get("TRAINING_SCRIPT", "/workspace/sd-scripts/sdxl_train_network.py")).resolve()
    if not p.exists():
        raise RuntimeError(f"Training script not found: {p}")
    return p


def _artifact_path(output_dir: Path, lora_id: str) -> Path:
    name = f"lora_{lora_id}.safetensors"
    return (output_dir / name).resolve()


def _run_and_log(cmd: List[str], log_path: Path) -> int:
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


def _build_command(lora_id: str, dataset_root: Path, output_dir: Path) -> List[str]:
    # Required envs (your current trainer flow expects these)
    pretrained_model = _require_env("PRETRAINED_MODEL")  # can be HF id OR local .safetensors path
    vae_path = _require_env("VAE_PATH")                  # local .safetensors path

    # Validate local paths when they look like paths
    if pretrained_model.startswith("/"):
        if not Path(pretrained_model).exists():
            raise RuntimeError(f"PRETRAINED_MODEL path does not exist: {pretrained_model}")
    if vae_path.startswith("/"):
        if not Path(vae_path).exists():
            raise RuntimeError(f"VAE_PATH does not exist: {vae_path}")

    # Defaults chosen for launch safety (you can tune later via env)
    resolution = os.environ.get("RESOLUTION", "1024,1024").strip()
    if "," not in resolution:
        # Allow "1024" -> convert to "1024,1024"
        resolution = f"{resolution},{resolution}"

    max_train_steps = _env_int("MAX_TRAIN_STEPS", 1200)
    train_batch_size = _env_int("TRAIN_BATCH_SIZE", 1)
    learning_rate = _env_float("LEARNING_RATE", 1e-4)
    network_dim = _env_int("NETWORK_DIM", 64)
    network_alpha = _env_int("NETWORK_ALPHA", 64)
    mixed_precision = os.environ.get("MIXED_PRECISION", "fp16").strip()

    use_xformers = os.environ.get("USE_XFORMERS", "1").strip().lower() in ("1", "true", "yes", "y", "on")
    gradient_checkpointing = os.environ.get("GRADIENT_CHECKPOINTING", "1").strip().lower() in ("1", "true", "yes", "y", "on")

    # BUCKETING — FORCED ON
    min_bucket_reso = _env_int("MIN_BUCKET_RESO", 256)
    max_bucket_reso = _env_int("MAX_BUCKET_RESO", 2048)

    if max_bucket_reso < min_bucket_reso:
        raise RuntimeError(f"MAX_BUCKET_RESO ({max_bucket_reso}) < MIN_BUCKET_RESO ({min_bucket_reso})")

    script = _training_script_path()

    cmd: List[str] = [
        sys.executable,
        str(script),
        f"--pretrained_model_name_or_path={pretrained_model}",
        f"--vae={vae_path}",
        f"--resolution={resolution}",
        f"--train_data_dir={str(dataset_root)}",
        f"--output_dir={str(output_dir)}",
        f"--output_name=lora_{lora_id}",
        "--network_module=networks.lora",
        f"--network_dim={network_dim}",
        f"--network_alpha={network_alpha}",
        f"--learning_rate={learning_rate}",
        f"--max_train_steps={max_train_steps}",
        f"--train_batch_size={train_batch_size}",
        f"--mixed_precision={mixed_precision}",
        "--save_model_as=safetensors",
    ]

    if gradient_checkpointing:
        cmd.append("--gradient_checkpointing")
    if use_xformers:
        cmd.append("--xformers")

    # ✅ THE FIX: FORCE BUCKETING ON (THIS MUST BE PRESENT)
    cmd += [
        "--enable_bucket",
        f"--min_bucket_reso={min_bucket_reso}",
        f"--max_bucket_reso={max_bucket_reso}",
    ]

    return cmd


# =========================
# Main
# =========================

def main() -> int:
    # Required envs
    lora_id = _require_env("LORA_ID")
    sb_url = _require_env("SUPABASE_URL")
    sb_key = _require_env("SUPABASE_SERVICE_ROLE_KEY")

    sb = SupabaseClient(sb_url, sb_key)

    # Load job
    job = sb.get_job(lora_id)
    _log(f"Loaded job: id={job.get('id')} user_id={job.get('user_id')} status={job.get('status')} name={job.get('name')}")

    if str(job.get("status", "")).strip() != "queued":
        raise RuntimeError(f"Job must start in status 'queued'. Found '{job.get('status')}'.")

    # Dataset wiring (HARD GATE)
    dataset_root = _resolve_dataset_dir(lora_id)
    _log(f"Resolved train_data_dir: {dataset_root}")
    img_count = _count_valid_images(dataset_root)

    min_images = _env_int("MIN_IMAGES", 10)
    max_images = _env_int("MAX_IMAGES", 20)
    if img_count < min_images or img_count > max_images:
        msg = f"Invalid image count: {img_count}. Required {min_images}-{max_images}. Dataset: {dataset_root}"
        sb.set_status(lora_id, "failed", msg)
        raise RuntimeError(msg)

    # Output dir + log path (stable defaults)
    output_dir = Path(os.environ.get("OUTPUT_DIR", "/workspace/output")).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    log_dir = Path(os.environ.get("LOG_DIR", f"/workspace/train_logs/sf_{lora_id}")).resolve()
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = (log_dir / "train.log").resolve()

    # Set training
    sb.set_status(lora_id, "training", None)
    _log(f"Updated status -> training (images={img_count}, steps≈{_env_int('MAX_TRAIN_STEPS', 1200)})")

    # Build + run
    cmd = _build_command(lora_id, dataset_root, output_dir)
    _log("Running: " + " ".join(shlex.quote(c) for c in cmd))

    rc = _run_and_log(cmd, log_path)

    if rc != 0:
        msg = f"Training failed with exit code {rc}. See log: {log_path}"
        _log(f"ERROR: {msg}")
        sb.set_status(lora_id, "failed", msg)
        return rc

    # Validate artifact (NO FAKE COMPLETIONS)
    artifact = _artifact_path(output_dir, lora_id)
    if not artifact.exists() or artifact.stat().st_size < 1024 * 1024:
        msg = f"Training finished but artifact missing/too small: {artifact}"
        _log(f"ERROR: {msg}")
        sb.set_status(lora_id, "failed", msg)
        return 2

    # Complete
    sb.set_status(lora_id, "complete", None)
    _log(f"✅ TRAINING COMPLETE: {artifact}")
    _log(f"Log: {log_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        # Best-effort fail status (but ONLY if env allows)
        try:
            lora_id = os.environ.get("LORA_ID", "").strip()
            sb_url = os.environ.get("SUPABASE_URL", "").strip()
            sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
            if lora_id and sb_url and sb_key:
                SupabaseClient(sb_url, sb_key).set_status(lora_id, "failed", str(e))
        except Exception:
            pass
        _log(f"ERROR: {e}")
        raise
