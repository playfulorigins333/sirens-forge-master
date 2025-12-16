#!/usr/bin/env python3
"""
SirensForge — Launch-Safe LoRA Trainer Worker (RunPod On-Demand)

Launch-safe rules:
- NEVER mark completed without a real .safetensors artifact on disk.
- If TRAINING_COMMAND is missing, AUTO-BUILD a safe SDXL LoRA command from env defaults.
- Update Supabase status: queued/failed -> training -> completed/failed.
- Optional: upload artifact to Supabase Storage.

Required env:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- LORA_ID

Optional env (auto-build mode):
- TRAINING_SCRIPT (default: /workspace/sd-scripts/sdxl_train_network.py)
- PRETRAINED_MODEL (path to SDXL .safetensors)  [required if TRAINING_COMMAND missing]
- VAE_PATH (path to VAE .safetensors)          [required if TRAINING_COMMAND missing]
- TRAIN_DATA_DIR (default: /workspace/train_data)
- RESOLUTION (default: 1024,1024)
- OUTPUT_DIR (default: /workspace/output)
- OUTPUT_NAME (default: lora)  -> writes <OUTPUT_DIR>/<OUTPUT_NAME>.safetensors
- NETWORK_DIM (default: 64)
- NETWORK_ALPHA (default: 64)
- LEARNING_RATE (default: 1e-4)
- MAX_TRAIN_STEPS (default: 100)
- TRAIN_BATCH_SIZE (default: 1)
- GRADIENT_CHECKPOINTING (default: 1)
- USE_XFORMERS (default: 1)    -> only enabled if xformers import succeeds
- MIXED_PRECISION (default: fp16)
- SAVE_MODEL_AS (default: safetensors)

Optional env (manual mode):
- TRAINING_COMMAND  (if set, worker uses it verbatim)
- TRAIN_OUTPUT_FILE (default derived from OUTPUT_DIR/OUTPUT_NAME)

Optional env (upload):
- OUTPUT_BUCKET     (Supabase Storage bucket name to upload artifact)
- OUTPUT_OBJECT_KEY (object key path inside bucket; default uses LORA_ID)
"""

import os
import sys
import json
import time
import shlex
import pathlib
import subprocess
from typing import Any, Dict, Optional, List

import requests


def log(msg: str) -> None:
    print(f"[lora-worker] {msg}", flush=True)


def require_env(name: str) -> str:
    val = os.getenv(name)
    if not val:
        raise RuntimeError(f"Missing env: {name}")
    return val


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def env_int(name: str, default: int) -> int:
    v = os.getenv(name)
    if v is None or str(v).strip() == "":
        return default
    return int(str(v).strip())


def supabase_headers(service_role_key: str) -> Dict[str, str]:
    return {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
    }


def sb_db_select_lora(sb_url: str, headers: Dict[str, str], lora_id: str) -> Dict[str, Any]:
    url = f"{sb_url.rstrip('/')}/rest/v1/user_loras"
    params = {
        "id": f"eq.{lora_id}",
        "select": "id,user_id,name,status,error_message,created_at",
        "limit": "1",
    }
    r = requests.get(url, headers=headers, params=params, timeout=30)
    if r.status_code >= 400:
        raise RuntimeError(f"Supabase select failed ({r.status_code}): {r.text}")
    rows = r.json()
    if not rows:
        raise RuntimeError(f"LoRA job not found in user_loras: {lora_id}")
    return rows[0]


def sb_db_update_lora(
    sb_url: str,
    headers: Dict[str, str],
    lora_id: str,
    status: str,
    error_message: Optional[str] = None,
) -> Dict[str, Any]:
    url = f"{sb_url.rstrip('/')}/rest/v1/user_loras?id=eq.{lora_id}"
    patch: Dict[str, Any] = {"status": status}
    if error_message is not None:
        patch["error_message"] = error_message

    update_headers = dict(headers)
    update_headers["Prefer"] = "return=representation"

    r = requests.patch(url, headers=update_headers, data=json.dumps(patch), timeout=30)
    if r.status_code >= 400:
        raise RuntimeError(f"Supabase update failed ({r.status_code}): {r.text}")

    rows = r.json()
    return rows[0] if rows else {}


def sb_storage_upload(
    sb_url: str,
    service_role_key: str,
    bucket: str,
    object_key: str,
    file_path: str,
) -> None:
    upload_url = f"{sb_url.rstrip('/')}/storage/v1/object/{bucket}/{object_key}"
    headers = {
        "Authorization": f"Bearer {service_role_key}",
        "apikey": service_role_key,
        "x-upsert": "true",
        "Content-Type": "application/octet-stream",
    }

    with open(file_path, "rb") as f:
        r = requests.put(upload_url, headers=headers, data=f, timeout=300)

    if r.status_code >= 400:
        raise RuntimeError(f"Storage upload failed ({r.status_code}): {r.text}")


def have_xformers() -> bool:
    try:
        import xformers  # noqa: F401
        import xformers.ops  # noqa: F401
        return True
    except Exception:
        return False


def build_training_command_and_output() -> (str, str):
    """
    If TRAINING_COMMAND is set: use it verbatim.
    Else: auto-build a safe SDXL LoRA training command from env vars.

    Returns:
      (training_command, output_file)
    """
    training_command = env("TRAINING_COMMAND", "")
    output_dir = env("OUTPUT_DIR", "/workspace/output")
    output_name = env("OUTPUT_NAME", "lora")
    output_file = env("TRAIN_OUTPUT_FILE", os.path.join(output_dir, f"{output_name}.safetensors"))

    # Manual mode
    if training_command:
        return training_command, output_file

    # Auto-build mode
    training_script = env("TRAINING_SCRIPT", "/workspace/sd-scripts/sdxl_train_network.py")
    pretrained = env("PRETRAINED_MODEL", "")
    vae = env("VAE_PATH", "")
    train_data_dir = env("TRAIN_DATA_DIR", "/workspace/train_data")
    resolution = env("RESOLUTION", "1024,1024")

    if not pretrained:
        raise RuntimeError("Auto-build mode missing env PRETRAINED_MODEL (path to SDXL checkpoint .safetensors).")
    if not vae:
        raise RuntimeError("Auto-build mode missing env VAE_PATH (path to VAE .safetensors).")

    network_dim = env_int("NETWORK_DIM", 64)
    network_alpha = env_int("NETWORK_ALPHA", 64)
    learning_rate = env("LEARNING_RATE", "1e-4")
    max_train_steps = env_int("MAX_TRAIN_STEPS", 100)
    train_batch_size = env_int("TRAIN_BATCH_SIZE", 1)
    grad_ckpt = env_int("GRADIENT_CHECKPOINTING", 1)
    use_xf = env_int("USE_XFORMERS", 1)
    mixed_precision = env("MIXED_PRECISION", "fp16")
    save_model_as = env("SAVE_MODEL_AS", "safetensors")
    network_module = env("NETWORK_MODULE", "networks.lora")

    pathlib.Path(output_dir).mkdir(parents=True, exist_ok=True)

    args: List[str] = [
        "python",
        training_script,
        f"--pretrained_model_name_or_path={pretrained}",
        f"--vae={vae}",
        f"--resolution={resolution}",
        f"--train_data_dir={train_data_dir}",
        f"--output_dir={output_dir}",
        f"--output_name={output_name}",
        f"--network_module={network_module}",
        f"--network_dim={network_dim}",
        f"--network_alpha={network_alpha}",
        f"--learning_rate={learning_rate}",
        f"--max_train_steps={max_train_steps}",
        f"--train_batch_size={train_batch_size}",
        f"--mixed_precision={mixed_precision}",
        f"--save_model_as={save_model_as}",
    ]

    if grad_ckpt == 1:
        args.append("--gradient_checkpointing")

    # Only enable if requested AND installed
    if use_xf == 1 and have_xformers():
        args.append("--xformers")

    training_command = shlex.join(args)
    return training_command, output_file


def run_training(training_command: str, output_file: str) -> None:
    """
    Contract:
      - Command must produce output_file on disk.
      - If output file missing/too small after, FAIL.
    """
    pathlib.Path(os.path.dirname(output_file)).mkdir(parents=True, exist_ok=True)

    cmd = shlex.split(training_command)
    log(f"Running TRAINING_COMMAND: {training_command}")
    start = time.time()

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    assert proc.stdout is not None
    for line in proc.stdout:
        print(line.rstrip("\n"), flush=True)

    code = proc.wait()
    elapsed = time.time() - start

    if code != 0:
        raise RuntimeError(f"Training command failed with exit code {code} after {elapsed:.1f}s")

    if not os.path.exists(output_file) or os.path.getsize(output_file) < 1024:
        raise RuntimeError(f"Training finished but output artifact missing/too small: {output_file}")

    log(f"Training complete in {elapsed:.1f}s. Artifact: {output_file} ({os.path.getsize(output_file)} bytes)")


def main() -> int:
    try:
        sb_url = require_env("SUPABASE_URL")
        service_key = require_env("SUPABASE_SERVICE_ROLE_KEY")
        lora_id = require_env("LORA_ID")
        headers = supabase_headers(service_key)

        job = sb_db_select_lora(sb_url, headers, lora_id)
        log(f"Loaded job: id={job.get('id')} user_id={job.get('user_id')} status={job.get('status')} name={job.get('name')}")

        sb_db_update_lora(sb_url, headers, lora_id, status="training", error_message=None)
        log("Updated status -> training")

        training_command, output_file = build_training_command_and_output()
        log(f"Resolved output file: {output_file}")

        run_training(training_command, output_file)

        # Optional upload
        output_bucket = env("OUTPUT_BUCKET", "")
        output_object_key = env("OUTPUT_OBJECT_KEY", "")

        if output_bucket:
            if not output_object_key:
                output_object_key = f"loras/{lora_id}/{os.path.basename(output_file)}"

            log(f"Uploading artifact -> supabase storage: {output_bucket}/{output_object_key}")
            sb_storage_upload(sb_url, service_key, output_bucket, output_object_key, output_file)
            log("Upload complete")

        sb_db_update_lora(sb_url, headers, lora_id, status="completed", error_message=None)
        log("Updated status -> completed")
        return 0

    except Exception as e:
        err = str(e)
        log(f"ERROR: {err}")

        # Best-effort failed status update
        try:
            sb_url = env("SUPABASE_URL", "")
            service_key = env("SUPABASE_SERVICE_ROLE_KEY", "")
            lora_id = env("LORA_ID", "")
            if sb_url and service_key and lora_id:
                headers = supabase_headers(service_key)
                sb_db_update_lora(sb_url, headers, lora_id, status="failed", error_message=err[:500])
                log("Updated status -> failed (best-effort)")
        except Exception as inner:
            log(f"Could not update status to failed: {inner}")

        return 1


if __name__ == "__main__":
    sys.exit(main())
