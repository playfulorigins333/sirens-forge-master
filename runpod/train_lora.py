import os
import sys
import time
import json
import shlex
import signal
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional, List, Tuple

import requests

# =========================
# Config
# =========================

VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

POLL_INTERVAL_SECONDS = int(os.getenv("LORA_WORKER_POLL_SECONDS", "5"))
IDLE_LOG_EVERY_SECONDS = int(os.getenv("LORA_WORKER_IDLE_LOG_EVERY_SECONDS", "30"))
HTTP_TIMEOUT_SECONDS = int(os.getenv("LORA_WORKER_HTTP_TIMEOUT_SECONDS", "30"))

# Training defaults (override via env if desired)
DEFAULT_MAX_TRAIN_STEPS = int(os.getenv("LORA_MAX_TRAIN_STEPS", "1200"))
DEFAULT_LEARNING_RATE = os.getenv("LORA_LEARNING_RATE", "1e-4")
DEFAULT_NETWORK_DIM = int(os.getenv("LORA_NETWORK_DIM", "64"))
DEFAULT_NETWORK_ALPHA = int(os.getenv("LORA_NETWORK_ALPHA", "64"))
DEFAULT_BATCH_SIZE = int(os.getenv("LORA_TRAIN_BATCH_SIZE", "1"))
DEFAULT_MIXED_PRECISION = os.getenv("LORA_MIXED_PRECISION", "fp16")  # fp16 or bf16
DEFAULT_SAVE_MODEL_AS = os.getenv("LORA_SAVE_MODEL_AS", "safetensors")

ENABLE_XFORMERS = os.getenv("LORA_ENABLE_XFORMERS", "1").strip() not in ("0", "false", "False")
ENABLE_BUCKET = os.getenv("LORA_ENABLE_BUCKET", "1").strip() not in ("0", "false", "False")
MIN_BUCKET_RESO = os.getenv("LORA_MIN_BUCKET_RESO", "256")
MAX_BUCKET_RESO = os.getenv("LORA_MAX_BUCKET_RESO", "2048")
BUCKET_RESO_STEPS = os.getenv("LORA_BUCKET_RESO_STEPS", "64")

# Paths
DATA_ROOT = Path("/workspace/train_data")
LOG_ROOT = Path("/workspace/train_logs")
OUTPUT_ROOT = Path("/workspace/output")
SD_SCRIPTS_TRAIN = Path("/workspace/sd-scripts/sdxl_train_network.py")

# Supabase enum statuses (locked)
STATUS_IDLE = "idle"
STATUS_QUEUED = "queued"
STATUS_TRAINING = "training"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"

# Graceful shutdown
_STOP = False


# =========================
# Helpers
# =========================

def log(msg: str) -> None:
    print(f"[train_lora_worker] {msg}", flush=True)


def require_env(name: str) -> str:
    v = os.getenv(name)
    if not v or not str(v).strip():
        raise RuntimeError(f"Missing env: {name}")
    return str(v).strip()


def now_iso_utc() -> str:
    # Keep it simple: UTC ISO-ish
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def safe_mkdir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def count_images(path: Path) -> int:
    n = 0
    for p in path.rglob("*"):
        if p.is_file() and p.suffix.lower() in VALID_EXTS:
            n += 1
    return n


def dataset_dir_for(lora_id: str) -> Path:
    return DATA_ROOT / f"sf_{lora_id}"


def output_dir_for(lora_id: str) -> Path:
    # Per-job output to prevent collisions
    return OUTPUT_ROOT / f"sf_{lora_id}"


def log_path_for(lora_id: str) -> Path:
    return LOG_ROOT / f"sf_{lora_id}.log"


def set_stop_flag(*_args: Any) -> None:
    global _STOP
    _STOP = True
    log("🛑 Stop signal received — worker will exit after current step.")


# =========================
# Supabase REST Client
# =========================

class SupabaseClient:
    def __init__(self, url: str, service_role_key: str):
        self.url = url.rstrip("/")
        self.key = service_role_key

    def _headers(self, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        h = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
        }
        if extra:
            h.update(extra)
        return h

    def fetch_oldest_queued_job(self) -> Optional[Dict[str, Any]]:
        """
        FIFO: oldest queued first.
        """
        r = requests.get(
            f"{self.url}/rest/v1/user_loras",
            headers=self._headers(),
            params={
                "select": "id,user_id,status,created_at",
                "status": f"eq.{STATUS_QUEUED}",
                "order": "created_at.asc",
                "limit": "1",
            },
            timeout=HTTP_TIMEOUT_SECONDS,
        )
        if r.status_code >= 300:
            raise RuntimeError(f"Supabase GET queued failed: {r.status_code} {r.text}")

        rows = r.json()
        if not rows:
            return None
        return rows[0]

    def claim_job_as_training(self, lora_id: str) -> bool:
        """
        Atomic claim:
        PATCH user_loras SET status='training' WHERE id=<id> AND status='queued'
        Returns True if we claimed, False if another worker already claimed or state changed.
        """
        payload = {
            "status": STATUS_TRAINING,
            "updated_at": now_iso_utc(),
            "started_at": now_iso_utc(),
        }

        r = requests.patch(
            f"{self.url}/rest/v1/user_loras",
            headers=self._headers({
                "Content-Type": "application/json",
                # Return rows so we can detect if we updated anything
                "Prefer": "return=representation",
            }),
            params={
                "id": f"eq.{lora_id}",
                "status": f"eq.{STATUS_QUEUED}",
            },
            json=payload,
            timeout=HTTP_TIMEOUT_SECONDS,
        )

        if r.status_code >= 300:
            raise RuntimeError(f"Supabase claim PATCH failed: {r.status_code} {r.text}")

        rows = r.json() if r.text else []
        return bool(rows)

    def set_failed(self, lora_id: str, message: str) -> None:
        payload = {
            "status": STATUS_FAILED,
            "updated_at": now_iso_utc(),
            "error_message": message[:2000],
        }
        r = requests.patch(
            f"{self.url}/rest/v1/user_loras",
            headers=self._headers({
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            }),
            params={"id": f"eq.{lora_id}"},
            json=payload,
            timeout=HTTP_TIMEOUT_SECONDS,
        )
        if r.status_code >= 300:
            raise RuntimeError(f"Supabase set_failed PATCH failed: {r.status_code} {r.text}")

    def set_completed(self, lora_id: str, extra: Optional[Dict[str, Any]] = None) -> None:
        payload: Dict[str, Any] = {
            "status": STATUS_COMPLETED,
            "updated_at": now_iso_utc(),
            "completed_at": now_iso_utc(),
        }
        if extra:
            payload.update(extra)

        r = requests.patch(
            f"{self.url}/rest/v1/user_loras",
            headers=self._headers({
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            }),
            params={"id": f"eq.{lora_id}"},
            json=payload,
            timeout=HTTP_TIMEOUT_SECONDS,
        )
        if r.status_code >= 300:
            raise RuntimeError(f"Supabase set_completed PATCH failed: {r.status_code} {r.text}")

    def update_progress(self, lora_id: str, progress: int) -> None:
        # Optional: only if you have a progress column. If not, this is harmless only if column exists.
        # If you don't have 'progress' column in DB, set env LORA_DISABLE_PROGRESS_UPDATES=1.
        if os.getenv("LORA_DISABLE_PROGRESS_UPDATES", "0").strip() in ("1", "true", "True"):
            return
        progress = max(0, min(100, int(progress)))
        payload = {"progress": progress, "updated_at": now_iso_utc()}
        r = requests.patch(
            f"{self.url}/rest/v1/user_loras",
            headers=self._headers({
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            }),
            params={"id": f"eq.{lora_id}"},
            json=payload,
            timeout=HTTP_TIMEOUT_SECONDS,
        )
        # If your DB does NOT have 'progress', this will 400. In that case, disable via env.
        if r.status_code >= 300:
            # Do not kill the whole job for a progress update failure.
            log(f"⚠️ Progress update failed (non-fatal): {r.status_code} {r.text}")


# =========================
# Training Runner
# =========================

def build_train_command(
    lora_id: str,
    dataset_dir: Path,
    output_dir: Path,
    pretrained_model: str,
    vae_path: str,
) -> List[str]:
    output_name = f"lora_{lora_id}"

    cmd: List[str] = [
        sys.executable,
        str(SD_SCRIPTS_TRAIN),
        "--pretrained_model_name_or_path", pretrained_model,
        "--vae", vae_path,
        "--resolution", "1024,1024",
        "--train_data_dir", str(dataset_dir),
        "--output_dir", str(output_dir),
        "--output_name", output_name,

        "--network_module", "networks.lora",
        "--network_dim", str(DEFAULT_NETWORK_DIM),
        "--network_alpha", str(DEFAULT_NETWORK_ALPHA),

        "--learning_rate", str(DEFAULT_LEARNING_RATE),
        "--max_train_steps", str(DEFAULT_MAX_TRAIN_STEPS),
        "--train_batch_size", str(DEFAULT_BATCH_SIZE),

        "--mixed_precision", str(DEFAULT_MIXED_PRECISION),
        "--save_model_as", str(DEFAULT_SAVE_MODEL_AS),
        "--gradient_checkpointing",
    ]

    if ENABLE_BUCKET:
        cmd += [
            "--enable_bucket",
            "--min_bucket_reso", str(MIN_BUCKET_RESO),
            "--max_bucket_reso", str(MAX_BUCKET_RESO),
            "--bucket_reso_steps", str(BUCKET_RESO_STEPS),
        ]

    if ENABLE_XFORMERS:
        cmd += ["--xformers"]

    # Extra args passthrough (optional)
    extra = os.getenv("LORA_TRAIN_EXTRA_ARGS", "").strip()
    if extra:
        # Safe-ish split (supports quoted strings)
        cmd += shlex.split(extra)

    return cmd


def run_training_process(
    cmd: List[str],
    stdout_log_path: Path,
    on_line=None,
) -> int:
    """
    Runs the training command, streaming output to:
    - Console
    - /workspace/train_logs/sf_<id>.log
    """
    safe_mkdir(stdout_log_path.parent)

    log("Running: " + " ".join(shlex.quote(c) for c in cmd))

    with stdout_log_path.open("a", encoding="utf-8", errors="replace") as f:
        f.write(f"\n\n===== TRAIN START {now_iso_utc()} =====\n")
        f.write("CMD: " + " ".join(shlex.quote(c) for c in cmd) + "\n\n")
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
            f.flush()
            if on_line:
                try:
                    on_line(line)
                except Exception:
                    pass

        rc = proc.wait()
        f.write(f"\n===== TRAIN END {now_iso_utc()} (rc={rc}) =====\n")
        f.flush()

    return rc


def artifact_path_for(lora_id: str, output_dir: Path) -> Path:
    return output_dir / f"lora_{lora_id}.safetensors"


def parse_progress_from_line(line: str) -> Optional[int]:
    """
    Optional: crude progress extraction from sd-scripts output.
    If it fails, we simply don't update progress.
    """
    # Common patterns (varies). We'll keep it conservative.
    # Example: "steps: 120/1200"
    if "steps:" in line and "/" in line:
        try:
            part = line.split("steps:", 1)[1].strip()
            # take first token like "120/1200"
            token = part.split()[0]
            a, b = token.split("/", 1)
            a_i = int(a.strip())
            b_i = int(b.strip())
            if b_i > 0:
                return int((a_i / b_i) * 100)
        except Exception:
            return None
    return None


# =========================
# Job Processing
# =========================

def process_job(sb: SupabaseClient, job: Dict[str, Any], pretrained_model: str, vae_path: str) -> None:
    lora_id = str(job["id"])
    status = str(job.get("status", "")).strip().lower()

    # Launch rule you locked:
    # If job isn't queued, do not mutate DB state (just skip cleanly).
    if status != STATUS_QUEUED:
        log(f"Job status is '{status}', not queued — exiting (no DB mutation).")
        return

    # Claim atomically
    claimed = sb.claim_job_as_training(lora_id)
    if not claimed:
        log(f"Job {lora_id} was not claimable (already taken or no longer queued). Skipping.")
        return

    log(f"✅ Claimed job -> training: {lora_id}")

    # Dataset wiring (CRITICAL)
    ds = dataset_dir_for(lora_id)
    if not ds.exists():
        sb.set_failed(lora_id, f"Dataset directory missing: {ds}")
        log(f"❌ Failed job {lora_id}: dataset directory missing")
        return

    img_count = count_images(ds)
    if img_count < 10 or img_count > 20:
        sb.set_failed(lora_id, f"Invalid image count: {img_count} (required 10–20)")
        log(f"❌ Failed job {lora_id}: invalid image count={img_count}")
        return

    # Output & logs
    out_dir = output_dir_for(lora_id)
    safe_mkdir(out_dir)
    safe_mkdir(LOG_ROOT)
    log_path = log_path_for(lora_id)

    # Build & run training
    if not SD_SCRIPTS_TRAIN.exists():
        sb.set_failed(lora_id, f"Training script missing: {SD_SCRIPTS_TRAIN}")
        log(f"❌ Failed job {lora_id}: missing training script")
        return

    cmd = build_train_command(
        lora_id=lora_id,
        dataset_dir=ds,
        output_dir=out_dir,
        pretrained_model=pretrained_model,
        vae_path=vae_path,
    )

    last_progress_sent = -1

    def on_line(line: str) -> None:
        nonlocal last_progress_sent
        p = parse_progress_from_line(line)
        if p is None:
            return
        # Only send if it changed meaningfully
        if p != last_progress_sent and (p == 0 or p == 100 or p - last_progress_sent >= 2):
            last_progress_sent = p
            sb.update_progress(lora_id, p)

    rc = run_training_process(cmd, log_path, on_line=on_line)

    if rc != 0:
        sb.set_failed(lora_id, f"Training exited with code {rc}")
        log(f"❌ Failed job {lora_id}: training rc={rc}")
        return

    # Artifact validation (NO fake completions)
    artifact = artifact_path_for(lora_id, out_dir)
    if not artifact.exists() or artifact.stat().st_size < 1024:
        sb.set_failed(lora_id, "Training finished but artifact missing or empty")
        log(f"❌ Failed job {lora_id}: artifact missing/empty at {artifact}")
        return

    # Mark complete
    sb.set_completed(
        lora_id,
        extra={
            "image_count": img_count,
            "artifact_path": str(artifact),
            "log_path": str(log_path),
        },
    )
    sb.update_progress(lora_id, 100)
    log(f"🎉 COMPLETED job {lora_id} -> {artifact}")


# =========================
# Worker Loop
# =========================

def worker_main() -> int:
    # Required env
    sb_url = require_env("SUPABASE_URL")
    sb_key = require_env("SUPABASE_SERVICE_ROLE_KEY")

    # Models required (local)
    pretrained_model = require_env("PRETRAINED_MODEL")
    vae_path = require_env("VAE_PATH")

    # Validate paths exist early (fail fast)
    if not Path(pretrained_model).exists():
        raise RuntimeError(f"PRETRAINED_MODEL not found: {pretrained_model}")
    if not Path(vae_path).exists():
        raise RuntimeError(f"VAE_PATH not found: {vae_path}")

    safe_mkdir(LOG_ROOT)
    safe_mkdir(OUTPUT_ROOT)
    safe_mkdir(DATA_ROOT)

    sb = SupabaseClient(sb_url, sb_key)

    log("🚀 LoRA worker started (always-on, fifo, launch-safe)")
    log(f"Polling every {POLL_INTERVAL_SECONDS}s | idle log every {IDLE_LOG_EVERY_SECONDS}s")
    log(f"Using PRETRAINED_MODEL={pretrained_model}")
    log(f"Using VAE_PATH={vae_path}")
    log(f"Train script: {SD_SCRIPTS_TRAIN}")

    last_idle_log = 0.0

    while not _STOP:
        try:
            job = sb.fetch_oldest_queued_job()
            if not job:
                now = time.time()
                if now - last_idle_log >= IDLE_LOG_EVERY_SECONDS:
                    log("⏳ No queued jobs — waiting")
                    last_idle_log = now
                time.sleep(POLL_INTERVAL_SECONDS)
                continue

            # We found a queued job; process it
            jid = str(job.get("id"))
            log(f"📥 Found queued job: {jid} (created_at={job.get('created_at')})")
            process_job(sb, job, pretrained_model, vae_path)

            # Small pause to avoid hammering if jobs arrive instantly
            time.sleep(1)

        except requests.RequestException as re:
            log(f"⚠️ Network error (will retry): {re}")
            time.sleep(POLL_INTERVAL_SECONDS)

        except Exception as e:
            # Worker-level error: log + keep running
            log(f"❌ Worker error (will continue): {e}")
            time.sleep(POLL_INTERVAL_SECONDS)

    log("✅ Worker exiting cleanly.")
    return 0


# =========================
# Entrypoint
# =========================

if __name__ == "__main__":
    # Handle shutdown signals
    signal.signal(signal.SIGINT, set_stop_flag)
    signal.signal(signal.SIGTERM, set_stop_flag)

    try:
        sys.exit(worker_main())
    except Exception as e:
        # If we can't even start the worker, that's fatal.
        log(f"❌ FATAL ERROR: {e}")
        raise