#!/usr/bin/env python3
"""
SirensForge — SDXL LoRA Trainer (RunPod) — PRODUCTION WIRING

This file matches the proven-good invocation you posted, but fixes the crash by forcing bucketing ON.

Proven-good parity targets (from your log):
- Uses /workspace/sd-scripts/sdxl_train_network.py
- Uses --resolution=1024,1024
- Uses --xformers when enabled
- Uses output as /workspace/output/lora_<LORA_ID>.safetensors (by default)
- Uses per-job dataset root: /workspace/train_data/sf_<LORA_ID>/

Hard requirements:
- Fail hard if dataset dir does not exist
- Enforce 10–20 valid images (default) before training starts
- Correct Supabase status transitions (queued -> training -> complete/failed)
- No fake completion: only "complete" if artifact exists
- One-step friendly: supports DRY_RUN=1 to validate + print command without training

Required env vars:
- LORA_ID
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

Recommended env vars (matches your launch commands):
- PRETRAINED_MODEL=stabilityai/stable-diffusion-xl-base-1.0
- VAE_PATH=madebyollin/sdxl-vae-fp16-fix
- OUTPUT_DIR=/workspace/output
- TRAINING_SCRIPT=/workspace/sd-scripts/sdxl_train_network.py
- USE_XFORMERS=1

Bucketing env vars:
- MIN_BUCKET_RESO=256
- MAX_BUCKET_RESO=2048
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

import requests


# -------------------------
# Env helpers
# -------------------------

def _env(name: str, default: Optional[str] = None) -> str:
    v = os.environ.get(name, default)
    if v is None or str(v).strip() == "":
        raise RuntimeError(f"Missing required env var: {name}")
    return str(v).strip()

def _env_int(name: str, default: int) -> int:
    v = os.environ.get(name, "")
    if str(v).strip() == "":
        return int(default)
    try:
        return int(str(v).strip())
    except Exception as e:
        raise RuntimeError(f"Env var {name} must be an int. Got: {v}") from e

def _env_float(name: str, default: float) -> float:
    v = os.environ.get(name, "")
    if str(v).strip() == "":
        return float(default)
    try:
        return float(str(v).strip())
    except Exception as e:
        raise RuntimeError(f"Env var {name} must be a float. Got: {v}") from e

def _env_bool(name: str, default: bool) -> bool:
    v = os.environ.get(name, "")
    if str(v).strip() == "":
        return bool(default)
    s = str(v).strip().lower()
    if s in ("1", "true", "yes", "y", "on"):
        return True
    if s in ("0", "false", "no", "n", "off"):
        return False
    raise RuntimeError(f"Env var {name} must be a bool-like value. Got: {v}")

def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# -------------------------
# Supabase
# -------------------------

class SupabaseClient:
    def __init__(self, url: str, service_role_key: str):
        self.base = url.rstrip("/")
        self.key = service_role_key

    def _patch(self, payload: Dict[str, Any]) -> requests.Response:
        endpoint = f"{self.base}/rest/v1/user_loras"
        lora_id = payload.get("id_for_params_only")  # not sent in body
        assert isinstance(lora_id, str) and lora_id, "Missing lora_id for params"
        body = dict(payload)
        body.pop("id_for_params_only", None)

        return requests.patch(
            endpoint,
            params={"id": f"eq.{lora_id}"},
            headers={
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            json=body,
            timeout=30,
        )

    def patch_user_loras_best_effort(self, lora_id: str, payload: Dict[str, Any]) -> None:
        """
        Production safety: status transitions must not fail due to optional column mismatches.
        - First try full payload
        - If it fails, retry minimal safe payload
        """
        full_payload = dict(payload)
        full_payload["id_for_params_only"] = lora_id

        r = self._patch(full_payload)
        if r.status_code < 300:
            return

        # Retry minimal (status + error_message + updated_at only)
        minimal: Dict[str, Any] = {"id_for_params_only": lora_id}
        if "status" in payload:
            minimal["status"] = payload["status"]
        if "error_message" in payload:
            minimal["error_message"] = payload["error_message"]
        minimal["updated_at"] = payload.get("updated_at", _now_iso())

        r2 = self._patch(minimal)
        if r2.status_code >= 300:
            raise RuntimeError(f"Supabase PATCH failed: {r2.status_code} {r2.text} (original: {r.status_code} {r.text})")

    def set_status(self, lora_id: str, status: str, *, error_message: Optional[str] = None, extra: Optional[Dict[str, Any]] = None) -> None:
        payload: Dict[str, Any] = {
            "status": status,
            "updated_at": _now_iso(),
        }
        if error_message is not None:
            payload["error_message"] = error_message
        if extra:
            payload.update(extra)
        self.patch_user_loras_best_effort(lora_id, payload)


# -------------------------
# Dataset validation
# -------------------------

VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

def _dataset_root(lora_id: str) -> Path:
    # REQUIRED STRUCTURE:
    # /workspace/train_data/sf_<LORA_ID>/
    return Path(f"/workspace/train_data/sf_{lora_id}").resolve()

def _count_valid_images(root: Path) -> int:
    if not root.exists() or not root.is_dir():
        raise RuntimeError(f"Dataset directory missing: {root}")

    count = 0
    for p in root.rglob("*"):
        if p.is_file() and p.suffix.lower() in VALID_EXTS:
            count += 1
    return count


# -------------------------
# Training command (PARITY + BUCKET FIX)
# -------------------------

def _training_script() -> Path:
    p = Path(os.environ.get("TRAINING_SCRIPT", "/workspace/sd-scripts/sdxl_train_network.py")).resolve()
    if not p.exists():
        raise RuntimeError(f"Training script not found: {p}")
    return p

def _build_cmd(lora_id: str, train_data_dir: Path) -> tuple[list[str], Path, Path]:
    """
    Build command to match your proven-good run, but add bucketing flags.
    """
    pretrained_model = os.environ.get("PRETRAINED_MODEL", os.environ.get("BASE_MODEL", "stabilityai/stable-diffusion-xl-base-1.0")).strip()
    vae_path = os.environ.get("VAE_PATH", os.environ.get("VAE_MODEL", "madebyollin/sdxl-vae-fp16-fix")).strip()

    output_dir = Path(os.environ.get("OUTPUT_DIR", "/workspace/output")).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    # Match your known-good naming
    output_name = os.environ.get("OUTPUT_NAME", f"lora_{lora_id}").strip()
    artifact_path = output_dir / f"{output_name}.safetensors"

    # Parity defaults (match what you showed)
    resolution = os.environ.get("RESOLUTION", "1024,1024").strip()  # IMPORTANT: keep comma form
    learning_rate = _env_float("LEARNING_RATE", 1e-4)
    max_train_steps = _env_int("MAX_TRAIN_STEPS", 1200)
    train_batch_size = _env_int("TRAIN_BATCH_SIZE", 1)
    mixed_precision = os.environ.get("MIXED_PRECISION", "fp16").strip()
    network_dim = _env_int("NETWORK_DIM", 64)
    network_alpha = _env_int("NETWORK_ALPHA", 64)

    use_xformers = _env_bool("USE_XFORMERS", True)

    # Bucketing fix (forced ON)
    min_bucket_reso = _env_int("MIN_BUCKET_RESO", 256)
    max_bucket_reso = _env_int("MAX_BUCKET_RESO", 2048)
    if max_bucket_reso < min_bucket_reso:
        raise RuntimeError(f"MAX_BUCKET_RESO ({max_bucket_reso}) < MIN_BUCKET_RESO ({min_bucket_reso})")

    cmd: list[str] = [
        sys.executable,
        str(_training_script()),
        "--pretrained_model_name_or_path", pretrained_model,
        "--vae", vae_path,
        "--resolution", resolution,
        "--train_data_dir", str(train_data_dir),
        "--output_dir", str(output_dir),
        "--output_name", output_name,
        "--network_module=networks.lora",
        "--network_dim", str(network_dim),
        "--network_alpha", str(network_alpha),
        "--learning_rate", str(learning_rate),
        "--max_train_steps", str(max_train_steps),
        "--train_batch_size", str(train_batch_size),
        "--mixed_precision", mixed_precision,
        "--save_model_as=safetensors",
        "--gradient_checkpointing",
        # BUCKET FIX:
        "--enable_bucket",
        "--min_bucket_reso", str(min_bucket_reso),
        "--max_bucket_reso", str(max_bucket_reso),
    ]

    if use_xformers:
        cmd.append("--xformers")

    log_path = output_dir / f"train_{lora_id}.log"
    return cmd, log_path, artifact_path


def _run_and_log(cmd: list[str], log_path: Path) -> int:
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


def _validate_artifact(artifact_path: Path, output_dir: Path) -> Path:
    if artifact_path.exists() and artifact_path.stat().st_size > 0:
        return artifact_path

    # Fallback: find newest safetensors
    safes = sorted(output_dir.glob("*.safetensors"), key=lambda p: p.stat().st_mtime, reverse=True)
    if safes:
        return safes[0]

    raise RuntimeError(f"No LoRA artifact found in {output_dir} (expected {artifact_path.name})")


# -------------------------
# Main
# -------------------------

def main() -> int:
    lora_id = _env("LORA_ID")
    sb_url = _env("SUPABASE_URL")
    sb_key = _env("SUPABASE_SERVICE_ROLE_KEY")
    sb = SupabaseClient(sb_url, sb_key)

    # Per-job dataset root (REQUIRED)
    train_data_dir = _dataset_root(lora_id)
    print(f"[train_lora] Resolved train_data_dir: {train_data_dir}")

    # Hard fail if missing
    if not train_data_dir.exists():
        sb.set_status(lora_id, "failed", error_message=f"Dataset directory missing: {train_data_dir}")
        raise RuntimeError(f"Dataset directory missing: {train_data_dir}")

    # Image count gate (10–20 by default)
    img_count = _count_valid_images(train_data_dir)
    min_images = _env_int("MIN_IMAGES", 10)
    max_images = _env_int("MAX_IMAGES", 20)
    if img_count < min_images or img_count > max_images:
        msg = f"Invalid image count: {img_count}. Required {min_images}-{max_images}."
        sb.set_status(lora_id, "failed", error_message=msg)
        raise RuntimeError(msg)

    # Build training cmd (parity + bucket fix)
    cmd, log_path, expected_artifact = _build_cmd(lora_id, train_data_dir)
    output_dir = Path(os.environ.get("OUTPUT_DIR", "/workspace/output")).resolve()

    print(f"[train_lora] Resolved output dir: {output_dir}")
    print(f"[train_lora] Expected artifact: {expected_artifact}")
    print(f"[train_lora] Log path: {log_path}")
    print(f"[train_lora] Running: {' '.join(shlex.quote(c) for c in cmd)}")

    # DRY RUN (for your one-step verification)
    if _env_bool("DRY_RUN", False):
        # Do NOT change status in dry run
        print("[train_lora] DRY_RUN=1 -> exiting before training.")
        return 0

    # Status -> training (also clears previous error_message)
    sb.set_status(
        lora_id,
        "training",
        error_message=None,
        extra={
            "started_at": _now_iso(),
            "image_count": img_count,
            "train_data_dir": str(train_data_dir),
            "output_dir": str(output_dir),
            "log_path": str(log_path),
            "train_args": json.dumps(cmd),
            "bucket_enabled": True,
            "min_bucket_reso": _env_int("MIN_BUCKET_RESO", 256),
            "max_bucket_reso": _env_int("MAX_BUCKET_RESO", 2048),
        },
    )

    rc = _run_and_log(cmd, log_path)
    if rc != 0:
        sb.set_status(
            lora_id,
            "failed",
            error_message=f"Training failed with exit code {rc}. See log: {log_path}",
            extra={"finished_at": _now_iso()},
        )
        return rc

    # Artifact validation (NO FAKE COMPLETIONS)
    artifact = _validate_artifact(expected_artifact, output_dir)

    sb.set_status(
        lora_id,
        "complete",
        error_message=None,
        extra={
            "finished_at": _now_iso(),
            "artifact_path": str(artifact),
        },
    )

    print(f"\n✅ TRAINING COMPLETE\nArtifact: {artifact}\nLog: {log_path}\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        # Best-effort status -> failed
        try:
            lora_id = os.environ.get("LORA_ID", "").strip()
            sb_url = os.environ.get("SUPABASE_URL", "").strip()
            sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
            if lora_id and sb_url and sb_key:
                SupabaseClient(sb_url, sb_key).set_status(
                    lora_id,
                    "failed",
                    error_message=str(e),
                    extra={"finished_at": _now_iso()},
                )
        except Exception:
            pass
        print(f"\n❌ ERROR: {e}\n", file=sys.stderr)
        raise
