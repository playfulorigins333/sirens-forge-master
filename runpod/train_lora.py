import os
import sys
import time
import shlex
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

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


def env_str(name: str, default: str) -> str:
    v = os.getenv(name)
    if not v or not str(v).strip():
        return default
    return str(v).strip()


def env_int(name: str, default: int) -> int:
    v = os.getenv(name)
    if not v or not str(v).strip():
        return default
    return int(v)


def now_iso() -> str:
    # PostgREST accepts ISO strings; Z is fine.
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


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
# Supabase Client (PostgREST)
# =========================

class SupabaseClient:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/")
        self.key = key

    def _headers(self, prefer: Optional[str] = None) -> Dict[str, str]:
        h = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
        }
        if prefer:
            h["Prefer"] = prefer
        return h

    def get_rows(
        self,
        table: str,
        select: str,
        params: Dict[str, str],
        timeout: int = 30,
    ) -> List[Dict[str, Any]]:
        r = requests.get(
            f"{self.url}/rest/v1/{table}",
            headers=self._headers(),
            params={"select": select, **params},
            timeout=timeout,
        )
        if r.status_code >= 300:
            raise RuntimeError(f"Supabase GET failed: {r.status_code} {r.text}")
        data = r.json()
        if isinstance(data, list):
            return data
        return []

    def patch_rows(
        self,
        table: str,
        params: Dict[str, str],
        payload: Dict[str, Any],
        return_representation: bool = False,
        timeout: int = 30,
    ) -> List[Dict[str, Any]]:
        prefer = "return=representation" if return_representation else "return=minimal"
        r = requests.patch(
            f"{self.url}/rest/v1/{table}",
            headers={
                **self._headers(prefer=prefer),
                "Content-Type": "application/json",
            },
            params=params,
            json=payload,
            timeout=timeout,
        )

        # If you request representation, you'll get [] when nothing matched.
        if r.status_code >= 300:
            raise RuntimeError(f"Supabase PATCH failed: {r.status_code} {r.text}")

        if return_representation:
            data = r.json()
            if isinstance(data, list):
                return data
            return []
        return []

    def set_status(
        self,
        lora_id: str,
        status: str,
        extra: Optional[Dict[str, Any]] = None,
    ) -> None:
        payload: Dict[str, Any] = {"status": status, "updated_at": now_iso()}
        if extra:
            payload.update(extra)
        self.patch_rows(
            "user_loras",
            params={"id": f"eq.{lora_id}"},
            payload=payload,
            return_representation=False,
        )


# =========================
# Job selection / claiming
# =========================

ACTIVE_STATUSES = {"queued", "training"}
TERMINAL_STATUSES = {"completed", "failed", "idle"}


def fetch_job_by_id(sb: SupabaseClient, lora_id: str) -> Optional[Dict[str, Any]]:
    rows = sb.get_rows(
        "user_loras",
        select="id,user_id,status,created_at",
        params={"id": f"eq.{lora_id}", "limit": "1"},
    )
    return rows[0] if rows else None


def user_has_other_active_job(sb: SupabaseClient, user_id: str, exclude_id: str) -> bool:
    # If the user has ANY other queued/training job, we should not start another.
    # This avoids the unique constraint collision and matches launch rule.
    rows = sb.get_rows(
        "user_loras",
        select="id,status,created_at",
        params={
            "user_id": f"eq.{user_id}",
            "status": "in.(queued,training)",
            "id": f"neq.{exclude_id}",
            "limit": "1",
        },
    )
    return len(rows) > 0


def next_queued_job_fifo(sb: SupabaseClient) -> Optional[Dict[str, Any]]:
    # FIFO: oldest queued first.
    rows = sb.get_rows(
        "user_loras",
        select="id,user_id,status,created_at",
        params={
            "status": "eq.queued",
            "order": "created_at.asc",
            "limit": "25",  # scan a few to skip users with active jobs
        },
    )
    if not rows:
        return None

    for row in rows:
        lora_id = str(row.get("id", "")).strip()
        user_id = str(row.get("user_id", "")).strip()
        if not lora_id or not user_id:
            continue

        # Active-job guard:
        if user_has_other_active_job(sb, user_id, exclude_id=lora_id):
            log(f"Skipping queued job {lora_id}: user already has an active job (queued|training).")
            continue

        return row

    return None


def claim_job(sb: SupabaseClient, lora_id: str) -> bool:
    # Claim by transitioning queued -> training, but ONLY if it is still queued.
    # This prevents two workers from taking the same job.
    try:
        claimed = sb.patch_rows(
            "user_loras",
            params={
                "id": f"eq.{lora_id}",
                "status": "eq.queued",
            },
            payload={
                "status": "training",
                "updated_at": now_iso(),
                "started_at": now_iso(),
                "error_message": None,
            },
            return_representation=True,
        )
        return len(claimed) == 1
    except Exception as e:
        # If something weird happens, do NOT clobber. Just log and move on.
        log(f"Claim failed for {lora_id}: {e}")
        return False


# =========================
# Training
# =========================

def run_training_for_job(
    sb: SupabaseClient,
    lora_id: str,
    pretrained_model: str,
    vae_path: str,
) -> int:
    dataset_dir = Path(f"/workspace/train_data/sf_{lora_id}")
    output_dir = Path("/workspace/output")
    logs_dir = Path("/workspace/train_logs")
    output_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)

    # HARD FAIL if dataset missing (and mark failed)
    if not dataset_dir.exists():
        sb.set_status(lora_id, "failed", {"error_message": f"Dataset directory missing: {dataset_dir}"})
        log(f"❌ Dataset directory missing: {dataset_dir}")
        return 1

    image_count = count_images(dataset_dir)
    if image_count < 10 or image_count > 20:
        sb.set_status(
            lora_id,
            "failed",
            {"error_message": f"Invalid image count: {image_count} (required 10–20)", "image_count": image_count},
        )
        log(f"❌ Image count gate failed: {image_count} (required 10–20)")
        return 2

    # Record image count (status already training from claim)
    try:
        sb.patch_rows(
            "user_loras",
            params={"id": f"eq.{lora_id}"},
            payload={"image_count": image_count, "updated_at": now_iso()},
            return_representation=False,
        )
    except Exception as e:
        log(f"Warning: could not write image_count for {lora_id}: {e}")

    train_script = "/workspace/sd-scripts/sdxl_train_network.py"
    if not os.path.exists(train_script):
        sb.set_status(lora_id, "failed", {"error_message": "sdxl_train_network.py not found on pod"})
        log("❌ sdxl_train_network.py not found")
        return 3

    # Validate model files exist
    if not os.path.exists(pretrained_model):
        sb.set_status(lora_id, "failed", {"error_message": f"Missing PRETRAINED_MODEL file: {pretrained_model}"})
        log(f"❌ Missing PRETRAINED_MODEL file: {pretrained_model}")
        return 4

    if not os.path.exists(vae_path):
        sb.set_status(lora_id, "failed", {"error_message": f"Missing VAE_PATH file: {vae_path}"})
        log(f"❌ Missing VAE_PATH file: {vae_path}")
        return 5

    output_name = f"lora_{lora_id}"
    artifact = output_dir / f"{output_name}.safetensors"
    log_path = logs_dir / f"sf_{lora_id}.log"

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

        # Bucketing ON for mixed-resolution uploads
        "--enable_bucket",
        "--min_bucket_reso", "256",
        "--max_bucket_reso", "2048",
        "--bucket_reso_steps", "64",

        "--xformers",
    ]

    log("Running: " + " ".join(shlex.quote(c) for c in cmd))
    log(f"Logging to: {log_path}")

    # Stream logs to file + stdout
    with open(log_path, "w", encoding="utf-8") as lf:
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
            lf.write(line)
        rc = proc.wait()

    if rc != 0:
        sb.set_status(lora_id, "failed", {"error_message": f"Training exited with code {rc}"})
        log(f"❌ Training failed (exit code {rc})")
        return rc

    # Validate artifact exists
    if not artifact.exists():
        sb.set_status(lora_id, "failed", {"error_message": "Training finished but artifact missing"})
        log("❌ Missing output artifact")
        return 6

    # Mark complete
    sb.set_status(
        lora_id,
        "completed",
        {
            "completed_at": now_iso(),
            "artifact_path": str(artifact),
            "error_message": None,
        },
    )
    log(f"✅ TRAINING COMPLETE: {artifact}")
    return 0


# =========================
# Worker loop
# =========================

def run_single_job_mode(sb: SupabaseClient, lora_id: str, pretrained_model: str, vae_path: str) -> int:
    row = fetch_job_by_id(sb, lora_id)
    if not row:
        log(f"❌ Job not found: {lora_id}")
        return 1

    status = str(row.get("status") or "").strip()
    user_id = str(row.get("user_id") or "").strip()

    # Launch-safe behavior:
    # If already active, exit cleanly and DO NOT mutate DB.
    if status in ACTIVE_STATUSES:
        log("Job already active — exiting (no DB mutation).")
        return 0

    # Only allow starting if it's queued (manual claim)
    if status != "queued":
        log(f"Job status is '{status}', not queued — exiting (no DB mutation).")
        return 0

    # Guard: user already has other active job?
    if user_id and user_has_other_active_job(sb, user_id, exclude_id=lora_id):
        log("User already has an active job — exiting (no DB mutation).")
        return 0

    if not claim_job(sb, lora_id):
        log("Could not claim job (already claimed by another worker?) — exiting.")
        return 0

    return run_training_for_job(sb, lora_id, pretrained_model, vae_path)


def run_worker_forever(sb: SupabaseClient, pretrained_model: str, vae_path: str, poll_seconds: int) -> int:
    log("✅ Queue worker started (always-on mode).")
    log(f"Using PRETRAINED_MODEL: {pretrained_model}")
    log(f"Using VAE_PATH:        {vae_path}")
    log(f"Polling every {poll_seconds}s")

    while True:
        try:
            job = next_queued_job_fifo(sb)
            if not job:
                time.sleep(poll_seconds)
                continue

            lora_id = str(job.get("id", "")).strip()
            if not lora_id:
                time.sleep(poll_seconds)
                continue

            # Try to claim
            if not claim_job(sb, lora_id):
                # someone else got it; keep looping
                time.sleep(1)
                continue

            # Run training
            rc = run_training_for_job(sb, lora_id, pretrained_model, vae_path)

            # Tiny cooldown so we don’t hammer Supabase
            time.sleep(2 if rc == 0 else 3)

        except KeyboardInterrupt:
            log("Worker stopped by user (Ctrl+C).")
            return 0
        except Exception as e:
            # Never crash the worker forever; log and keep going.
            log(f"❌ Worker loop error: {e}")
            time.sleep(max(5, poll_seconds))

    return 0


def main() -> int:
    sb_url = require_env("SUPABASE_URL")
    sb_key = require_env("SUPABASE_SERVICE_ROLE_KEY")

    # Defaults so the pod can run without extra env wiring
    pretrained_model = env_str("PRETRAINED_MODEL", "/workspace/models/checkpoints/sdxl_base_1.0.safetensors")
    vae_path = env_str("VAE_PATH", "/workspace/models/vae/sdxl_vae.safetensors")
    poll_seconds = env_int("WORKER_POLL_SECONDS", 5)

    sb = SupabaseClient(sb_url, sb_key)

    # If LORA_ID is set, run that job once (manual mode).
    lora_id = os.getenv("LORA_ID")
    if lora_id and str(lora_id).strip():
        return run_single_job_mode(sb, str(lora_id).strip(), pretrained_model, vae_path)

    # Otherwise run forever as queue worker.
    return run_worker_forever(sb, pretrained_model, vae_path, poll_seconds)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log(f"❌ FATAL ERROR: {e}")
        sys.exit(1)