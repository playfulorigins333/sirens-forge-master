#!/usr/bin/env python3
"""
SirensForge — Launch-Safe LoRA Trainer Worker (RunPod On-Demand)

Design goals:
- Single-job, on-demand, cheap (T4/A10).
- NO fake "completed".
- If training isn't configured, job FAILS with a clear error and updates Supabase.
- Updates Supabase status: queued -> training -> completed/failed.

Required env:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- LORA_ID

Optional env:
- TRAINING_COMMAND  (if not set, worker will FAIL with "Training not configured")
- TRAIN_OUTPUT_FILE (default: /workspace/output/lora.safetensors)
- OUTPUT_BUCKET     (Supabase Storage bucket name to upload artifact)
- OUTPUT_OBJECT_KEY (object key path inside bucket; default uses LORA_ID)

Notes:
- This worker uses Supabase REST (PostgREST) for DB updates and Storage HTTP for uploads.
- It does NOT assume any dataset storage layout yet (we’ll wire that next).
"""

import os
import sys
import json
import time
import shlex
import pathlib
import subprocess
from typing import Any, Dict, Optional

import requests


def log(msg: str) -> None:
    print(f"[lora-worker] {msg}", flush=True)


def require_env(name: str) -> str:
    val = os.getenv(name)
    if not val:
        raise RuntimeError(f"Missing env: {name}")
    return val


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
    # Only set error_message when provided (so we don't wipe it accidentally).
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
        r = requests.put(upload_url, headers=headers, data=f, timeout=120)

    if r.status_code >= 400:
        raise RuntimeError(f"Storage upload failed ({r.status_code}): {r.text}")


def run_training(training_command: str, output_file: str) -> None:
    """
    Runs TRAINING_COMMAND as a shell-like command.
    Contract:
      - Command must produce TRAIN_OUTPUT_FILE on disk.
      - If output file not present after, we FAIL.
    """
    pathlib.Path(os.path.dirname(output_file)).mkdir(parents=True, exist_ok=True)

    cmd = shlex.split(training_command)
    log(f"Running TRAINING_COMMAND: {training_command}")
    start = time.time()

    # Stream stdout/stderr live
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    assert proc.stdout is not None
    for line in proc.stdout:
        print(line.rstrip("\n"), flush=True)

    code = proc.wait()
    elapsed = time.time() - start

    if code != 0:
        raise RuntimeError(f"Training command failed with exit code {code} after {elapsed:.1f}s")

    if not os.path.exists(output_file) or os.path.getsize(output_file) < 1024:
        # Guardrail: don't ever mark completed without a real artifact.
        raise RuntimeError(
            f"Training finished but output artifact missing/too small: {output_file}"
        )

    log(f"Training complete in {elapsed:.1f}s. Artifact: {output_file} ({os.path.getsize(output_file)} bytes)")


def main() -> int:
    try:
        sb_url = require_env("SUPABASE_URL")
        service_key = require_env("SUPABASE_SERVICE_ROLE_KEY")
        lora_id = require_env("LORA_ID")

        headers = supabase_headers(service_key)

        # 1) Confirm job exists
        job = sb_db_select_lora(sb_url, headers, lora_id)
        log(f"Loaded job: id={job.get('id')} user_id={job.get('user_id')} status={job.get('status')} name={job.get('name')}")

        # 2) Move to training immediately (launch-safe state transition)
        sb_db_update_lora(sb_url, headers, lora_id, status="training", error_message=None)
        log("Updated status -> training")

        # 3) Require actual training command (NO fake completion)
        training_command = os.getenv("TRAINING_COMMAND", "").strip()
        output_file = os.getenv("TRAIN_OUTPUT_FILE", "/workspace/output/lora.safetensors").strip()

        if not training_command:
            raise RuntimeError(
                "Training not configured: missing env TRAINING_COMMAND. "
                "This worker will not fake completion."
            )

        # 4) Run training
        run_training(training_command, output_file)

        # 5) Upload artifact (optional but recommended)
        output_bucket = os.getenv("OUTPUT_BUCKET", "").strip()
        output_object_key = os.getenv("OUTPUT_OBJECT_KEY", "").strip()

        if output_bucket:
            if not output_object_key:
                # Default object key
                output_object_key = f"loras/{lora_id}/lora.safetensors"

            log(f"Uploading artifact -> supabase storage: {output_bucket}/{output_object_key}")
            sb_storage_upload(sb_url, service_key, output_bucket, output_object_key, output_file)
            log("Upload complete")

        # 6) Mark completed
        sb_db_update_lora(sb_url, headers, lora_id, status="completed", error_message=None)
        log("Updated status -> completed")
        return 0

    except Exception as e:
        err = str(e)
        log(f"ERROR: {err}")

        # Best-effort: update Supabase status -> failed
        try:
            sb_url = os.getenv("SUPABASE_URL", "").strip()
            service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
            lora_id = os.getenv("LORA_ID", "").strip()

            if sb_url and service_key and lora_id:
                headers = supabase_headers(service_key)
                sb_db_update_lora(sb_url, headers, lora_id, status="failed", error_message=err[:500])
                log("Updated status -> failed (best-effort)")
        except Exception as inner:
            log(f"Could not update status to failed: {inner}")

        return 1


if __name__ == "__main__":
    sys.exit(main())
