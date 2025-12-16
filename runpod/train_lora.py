cd /workspace/sirens-forge-master

cat > runpod/train_lora.py <<'PY'
import os
import sys
import json
import time
import shlex
import pathlib
import subprocess
from typing import Any, Dict, Optional, List, Tuple

import requests

# -------------------------
# Helpers
# -------------------------

def log(msg: str) -> None:
    print(f"[train_lora] {msg}", flush=True)


def require_env(name: str) -> str:
    val = os.getenv(name)
    if not val or not str(val).strip():
        raise RuntimeError(f"Missing env: {name}")
    return str(val).strip()


def env(name: str, default: str = "") -> str:
    v = os.getenv(name)
    if v is None:
        return default
    return str(v).strip()


def env_int(name: str, default: int) -> int:
    v = os.getenv(name)
    if v is None or str(v).strip() == "":
        return default
    return int(str(v).strip())


def supabase_headers(service_role_key: str, prefer_return: bool = False) -> Dict[str, str]:
    h = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
    }
    if prefer_return:
        h["Prefer"] = "return=representation"
    return h


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

    r = requests.patch(
        url,
        headers=supabase_headers(headers["apikey"], prefer_return=True),
        data=json.dumps(patch),
        timeout=30,
    )
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


# -------------------------
# Dataset wiring + gates
# -------------------------

VALID_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def dataset_dir_for_job(lora_id: str) -> pathlib.Path:
    # REQUIRED structure:
    # /workspace/train_data/sf_<LORA_ID>/
    return pathlib.Path("/workspace/train_data") / f"sf_{lora_id}"


def list_valid_images(dataset_dir: pathlib.Path) -> List[pathlib.Path]:
    images: List[pathlib.Path] = []
    if not dataset_dir.exists():
        return images
    for p in dataset_dir.rglob("*"):
        if p.is_file() and p.suffix.lower() in VALID_IMAGE_EXTS:
            images.append(p)
    return sorted(images)


def enforce_image_count_or_fail(images: List[pathlib.Path]) -> Tuple[int, str]:
    n = len(images)
    if n < 10:
        return n, f"Not enough training images. Found {n}, but minimum is 10."
    if n > 20:
        return n, f"Too many training images. Found {n}, but maximum is 20."
    return n, ""


# -------------------------
# Steps scaling (baseline)
# -------------------------

def scaled_steps(image_count: int) -> int:
    """
    Baseline locked:
      10 images -> ~1200 steps
      20 images -> ~2000 steps
    Linear scale in between.
    """
    c = max(10, min(20, int(image_count)))
    steps = 1200 + (c - 10) * (2000 - 1200) // 10
    return int(steps)


# -------------------------
# Command build (SDXL diffusers only)
# -------------------------

def _looks_like_safetensors_file(p: str) -> bool:
    return bool(p) and p.lower().endswith(".safetensors") and os.path.isfile(p)


def _looks_like_local_dir(p: str) -> bool:
    return bool(p) and os.path.isdir(p)


def build_training_command_and_output(
    lora_id: str,
    train_data_dir: pathlib.Path,
    image_count: int,
) -> Tuple[str, str]:
    training_script = env("TRAINING_SCRIPT", "/workspace/sd-scripts/sdxl_train_network.py")

    pretrained = env("PRETRAINED_MODEL", "")
    if not pretrained:
        raise RuntimeError("Missing env PRETRAINED_MODEL. Use a Diffusers repo id (e.g. stabilityai/stable-diffusion-xl-base-1.0) or a local Diffusers folder.")
    if _looks_like_safetensors_file(pretrained):
        raise RuntimeError(
            "PRETRAINED_MODEL points to a .safetensors file. This SDXL training script expects a Diffusers repo id or Diffusers directory, not a single checkpoint file."
        )

    vae = env("VAE_PATH", "")
    # IMPORTANT: For this sd-scripts SDXL path, --vae must be a diffusers repo/folder (with config.json),
    # not a .safetensors. If user provides .safetensors, we SKIP it instead of looping/failing.
    use_vae = False
    if vae:
        if _looks_like_safetensors_file(vae):
            log("WARNING: VAE_PATH is a .safetensors file. sd-scripts expects a Diffusers VAE repo/folder. Skipping --vae.")
            use_vae = False
        elif _looks_like_local_dir(vae):
            use_vae = True
        else:
            # treat as HF repo id like "madebyollin/sdxl-vae-fp16-fix"
            use_vae = True

    resolution = env("RESOLUTION", "1024,1024")

    output_dir = env("OUTPUT_DIR", "/workspace/output")
    output_name = env("OUTPUT_NAME", f"lora_{lora_id}")
    pathlib.Path(output_dir).mkdir(parents=True, exist_ok=True)

    max_train_steps = scaled_steps(image_count)

    network_dim = env_int("NETWORK_DIM", 64)
    network_alpha = env_int("NETWORK_ALPHA", 64)
    learning_rate = env("LEARNING_RATE", "1e-4")
    train_batch_size = env_int("TRAIN_BATCH_SIZE", 1)
    mixed_precision = env("MIXED_PRECISION", "fp16")
    save_model_as = env("SAVE_MODEL_AS", "safetensors")
    network_module = env("NETWORK_MODULE", "networks.lora")

    gradient_checkpointing = env_int("GRADIENT_CHECKPOINTING", 1) == 1
    request_xformers = env_int("USE_XFORMERS", 1) == 1

    args: List[str] = [
        "python",
        training_script,
        f"--pretrained_model_name_or_path={pretrained}",
        f"--resolution={resolution}",
        f"--train_data_dir={str(train_data_dir)}",
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

    if use_vae:
        args.insert(3, f"--vae={vae}")  # keep near pretrained for readability

    if gradient_checkpointing:
        args.append("--gradient_checkpointing")

    if request_xformers and have_xformers():
        args.append("--xformers")

    training_command = shlex.join(args)
    output_file = os.path.join(output_dir, f"{output_name}.safetensors")
    return training_command, output_file


# -------------------------
# Artifact validation
# -------------------------

def validate_artifact_or_fail(output_file: str) -> None:
    if not os.path.exists(output_file):
        raise RuntimeError(f"Training finished but artifact missing: {output_file}")
    size = os.path.getsize(output_file)
    if size <= 1_000_000:
        raise RuntimeError(f"Artifact too small ({size} bytes). Expected > 1MB. File: {output_file}")


# -------------------------
# Training runner
# -------------------------

def run_training(training_command: str) -> None:
    cmd = shlex.split(training_command)
    log(f"Running: {training_command}")

    start = time.time()
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    assert proc.stdout is not None
    for line in proc.stdout:
        print(line.rstrip("\n"), flush=True)

    code = proc.wait()
    elapsed = time.time() - start

    if code != 0:
        raise RuntimeError(f"Training failed with exit code {code} after {elapsed:.1f}s")

    log(f"Training process exited 0 in {elapsed:.1f}s")


# -------------------------
# Status contract
# -------------------------

def enforce_transition_or_fail(current: str, target: str) -> None:
    allowed = {
        ("queued", "training"),
        ("training", "completed"),
        ("training", "failed"),
        ("queued", "failed"),
    }
    if (current, target) not in allowed:
        raise RuntimeError(f"Illegal status transition: {current} -> {target}")


# -------------------------
# Main
# -------------------------

def main() -> int:
    sb_url = ""
    service_key = ""
    lora_id = ""

    try:
        sb_url = require_env("SUPABASE_URL")
        service_key = require_env("SUPABASE_SERVICE_ROLE_KEY")
        lora_id = require_env("LORA_ID")

        headers = supabase_headers(service_key)

        job = sb_db_select_lora(sb_url, headers, lora_id)
        current_status = (job.get("status") or "").strip().lower()
        log(f"Loaded job: id={job.get('id')} user_id={job.get('user_id')} status={current_status} name={job.get('name')}")

        if current_status != "queued":
            raise RuntimeError(f"Job must start in status 'queued'. Found '{current_status}'.")

        train_dir = dataset_dir_for_job(lora_id)
        if not train_dir.exists():
            raise RuntimeError(f"Dataset directory missing: {train_dir}")

        images = list_valid_images(train_dir)
        n, gate_err = enforce_image_count_or_fail(images)
        if gate_err:
            enforce_transition_or_fail("queued", "training")
            sb_db_update_lora(sb_url, headers, lora_id, status="training", error_message=None)
            log("Updated status -> training")
            enforce_transition_or_fail("training", "failed")
            sb_db_update_lora(sb_url, headers, lora_id, status="failed", error_message=gate_err[:500])
            log(f"Updated status -> failed (image gate): {gate_err}")
            return 1

        enforce_transition_or_fail("queued", "training")
        sb_db_update_lora(sb_url, headers, lora_id, status="training", error_message=None)
        log(f"Updated status -> training (images={n}, steps≈{scaled_steps(n)})")

        training_command, output_file = build_training_command_and_output(
            lora_id=lora_id,
            train_data_dir=train_dir,
            image_count=n,
        )
        log(f"Resolved train_data_dir: {train_dir}")
        log(f"Resolved output file: {output_file}")

        run_training(training_command)
        validate_artifact_or_fail(output_file)

        output_bucket = env("OUTPUT_BUCKET", "")
        if output_bucket:
            object_key = f"loras/{lora_id}/{os.path.basename(output_file)}"
            log(f"Uploading artifact -> {output_bucket}/{object_key}")
            sb_storage_upload(sb_url, service_key, output_bucket, object_key, output_file)
            log("Upload complete")

        enforce_transition_or_fail("training", "completed")
        sb_db_update_lora(sb_url, headers, lora_id, status="completed", error_message=None)
        log("Updated status -> completed")
        return 0

    except Exception as e:
        err = str(e)
        log(f"ERROR: {err}")

        try:
            if sb_url and service_key and lora_id:
                headers = supabase_headers(service_key)
                job = sb_db_select_lora(sb_url, headers, lora_id)
                current_status = (job.get("status") or "").strip().lower()

                if current_status == "queued":
                    enforce_transition_or_fail("queued", "failed")
                    sb_db_update_lora(sb_url, headers, lora_id, status="failed", error_message=err[:500])
                    log("Updated status -> failed (queued->failed)")
                elif current_status == "training":
                    enforce_transition_or_fail("training", "failed")
                    sb_db_update_lora(sb_url, headers, lora_id, status="failed", error_message=err[:500])
                    log("Updated status -> failed (training->failed)")
                else:
                    sb_db_update_lora(sb_url, headers, lora_id, status="failed", error_message=err[:500])
                    log("Updated status -> failed (fallback)")
        except Exception as inner:
            log(f"Could not update status to failed: {inner}")

        return 1


if __name__ == "__main__":
    sys.exit(main())
PY
