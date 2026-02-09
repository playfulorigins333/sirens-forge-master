cat > /workspace/sirens-forge-clean/runpod/train_lora.py <<'PY'
#!/usr/bin/env python3
"""
SirensForge - Always-on LoRA Training Worker (PRODUCTION)
R2 STORAGE (S3-compatible) + Supabase REST

✅ Processes ONLY status='queued'
✅ ALSO requires user_id IS NOT NULL (prevents lora_status_events null user_id trigger failures)
✅ No stale-training reclaim (avoids grabbing jobs that don't have datasets yet)
✅ sd-scripts compatible dataset structure (SDXL)
✅ Per-job dataset folder: /workspace/train_data/sf_<JOB_ID>/
✅ Hard image gate: 10–20 images
✅ Repeat/steps targeting ~1200 effective samples
✅ SDXL-safe concept enforcement via captions (.txt)
✅ Hard-fail on missing dataset / missing artifact / tiny artifact
✅ Supabase schema-safe PATCH (auto-strips unknown columns)
✅ Cloudflare R2 dataset download + artifact upload
✅ Terminal-status email notify (Edge Function) — ONLY on completed/failed

NEW (Identity Lock Upgrade):
✅ Auto-caption each image with BLIP
✅ Inject a stable per-LoRA TRIGGER TOKEN into every caption
✅ This trains an "identity token" like Galaxy does

IMPORTANT:
- Datasets must exist in R2 under: lora_datasets/<lora_id>/...
- Artifacts go to R2 under: loras/<lora_id>/final.safetensors
"""

import os
import sys
import time
import json
import re
import uuid
import shutil
import subprocess
from typing import Dict, Any, List, Tuple, Optional

import requests

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

# Captioning (BLIP)
from PIL import Image

_BLIP_READY = False
_BLIP_PROCESSOR = None
_BLIP_MODEL = None


# ─────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────
def log(msg: str) -> None:
    print(f"[train_lora_worker] {msg}", flush=True)


def require_env(name: str) -> str:
    v = os.getenv(name)
    if not v:
        raise RuntimeError(f"Missing env: {name}")
    return v


# ─────────────────────────────────────────────────────────────
# UUID hardening
# ─────────────────────────────────────────────────────────────
CONTROL_CHARS_RE = re.compile(r"[\x00-\x1F\x7F]")  # includes \b (\x08), \n, \r, etc.
UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def sanitize_uuid(raw: Any, field: str) -> str:
    if raw is None:
        raise ValueError(f"{field} is None")

    s = str(raw)
    no_ctl = CONTROL_CHARS_RE.sub("", s)
    clean = no_ctl.strip()

    if clean.lower().startswith("id="):
        clean = clean[3:].strip()

    try:
        u = uuid.UUID(clean)
        out = str(u)
    except Exception:
        debug = {
            "field": field,
            "raw_repr": repr(s),
            "raw_utf8_hex": s.encode("utf-8", "backslashreplace").hex(),
            "no_ctl_repr": repr(no_ctl),
            "clean_repr": repr(clean),
        }
        raise ValueError(f"Invalid UUID for {field}. Debug: {json.dumps(debug, ensure_ascii=False)}")

    if not UUID_RE.match(out):
        raise ValueError(f"Canonical UUID format failed for {field}: {out!r}")

    if out != clean:
        log(f"🧼 UUID sanitized {field}: {clean!r} -> {out!r}")

    return out


def sanitize_eq_filter(value: Any, field: str) -> str:
    if value is None:
        raise ValueError(f"{field} filter is None")

    s = CONTROL_CHARS_RE.sub("", str(value)).strip()

    if s.lower().startswith("eq."):
        raw_uuid = s[3:].strip()
        u = sanitize_uuid(raw_uuid, f"{field} (eq filter)")
        return f"eq.{u}"

    return s


# ─────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────
SUPABASE_URL = require_env("SUPABASE_URL").rstrip("/")
SUPABASE_KEY = require_env("SUPABASE_SERVICE_ROLE_KEY")

PRETRAINED_MODEL = require_env("PRETRAINED_MODEL")
VAE_PATH = require_env("VAE_PATH")

LOCAL_TRAIN_ROOT = os.getenv("LORA_LOCAL_TRAIN_ROOT", "/workspace/train_data")
OUTPUT_ROOT = os.getenv("LORA_OUTPUT_ROOT", "/workspace/output_loras")

TRAIN_SCRIPT = os.getenv("TRAIN_SCRIPT", "/workspace/sd-scripts/sdxl_train_network.py")
PYTHON_BIN = os.getenv("PYTHON_BIN", sys.executable)

NETWORK_MODULE = os.getenv("LORA_NETWORK_MODULE", "networks.lora")

POLL_SECONDS = 5
IDLE_LOG_SECONDS = 30

MIN_IMAGES = 10
MAX_IMAGES = 20
TARGET_SAMPLES = 1200

# Old concept token default is NOT enough for identity lock; we keep it as fallback only.
CONCEPT_TOKEN = os.getenv("LORA_CONCEPT_TOKEN", "concept")
CAPTION_EXTENSION = os.getenv("LORA_CAPTION_EXTENSION", ".txt")

# Captioning controls
USE_BLIP_CAPTIONS = os.getenv("LORA_USE_BLIP_CAPTIONS", "1").strip() == "1"
BLIP_MODEL_ID = os.getenv("LORA_BLIP_MODEL_ID", "Salesforce/blip-image-captioning-base")
# What to inject into captions. "woman" works well for your current use case.
TRIGGER_SUFFIX = os.getenv("LORA_TRIGGER_SUFFIX", "woman").strip() or "person"
# Optional extra prefix to bias training; keep short to avoid overfitting.
CAPTION_STYLE_PREFIX = os.getenv("LORA_CAPTION_STYLE_PREFIX", "").strip()

ARTIFACT_MIN_BYTES = 2 * 1024 * 1024  # 2MB

LORA_NOTIFY_ENDPOINT = os.getenv(
    "LORA_NOTIFY_ENDPOINT",
    f"{SUPABASE_URL}/functions/v1/lora-status-notify",
).rstrip("/")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")


# ─────────────────────────────────────────────────────────────
# R2 Config (S3 compatible)
# ─────────────────────────────────────────────────────────────
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_ENDPOINT = os.getenv("R2_ENDPOINT")
AWS_DEFAULT_REGION = os.getenv("AWS_DEFAULT_REGION", "auto")

R2_BUCKET = os.getenv("R2_BUCKET")

R2_DATASET_BUCKET = os.getenv("R2_DATASET_BUCKET", R2_BUCKET)
R2_ARTIFACT_BUCKET = os.getenv("R2_ARTIFACT_BUCKET", R2_BUCKET)

R2_DATASET_PREFIX_ROOT = os.getenv("R2_DATASET_PREFIX_ROOT", "lora_datasets")
R2_ARTIFACT_PREFIX_ROOT = os.getenv("R2_ARTIFACT_PREFIX_ROOT", "loras")


def _clean_prefix(p: str) -> str:
    p = (p or "").strip()
    while p.startswith("/"):
        p = p[1:]
    while p.endswith("/"):
        p = p[:-1]
    return p


R2_DATASET_PREFIX_ROOT = _clean_prefix(R2_DATASET_PREFIX_ROOT)
R2_ARTIFACT_PREFIX_ROOT = _clean_prefix(R2_ARTIFACT_PREFIX_ROOT)


def r2_enabled() -> bool:
    return bool(
        R2_ACCESS_KEY_ID
        and R2_SECRET_ACCESS_KEY
        and R2_ENDPOINT
        and R2_DATASET_BUCKET
        and R2_ARTIFACT_BUCKET
    )


def make_r2_client():
    if not r2_enabled():
        raise RuntimeError(
            "R2 env missing. Required: "
            "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET "
            "(or explicit R2_DATASET_BUCKET / R2_ARTIFACT_BUCKET)."
        )

    session = boto3.session.Session()
    cfg = BotoConfig(
        region_name=AWS_DEFAULT_REGION,
        retries={"max_attempts": 10, "mode": "standard"},
        signature_version="s3v4",
    )

    return session.client(
        "s3",
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        endpoint_url=R2_ENDPOINT,
        config=cfg,
    )


# ─────────────────────────────────────────────────────────────
# Sanity checks
# ─────────────────────────────────────────────────────────────
def sanity_checks() -> None:
    for p, name in [
        (PRETRAINED_MODEL, "PRETRAINED_MODEL"),
        (VAE_PATH, "VAE_PATH"),
        (TRAIN_SCRIPT, "TRAIN_SCRIPT"),
    ]:
        if not os.path.exists(p):
            raise RuntimeError(f"{name} not found: {p}")

    if not CAPTION_EXTENSION.startswith("."):
        raise RuntimeError("LORA_CAPTION_EXTENSION must start with '.'")

    if not r2_enabled():
        raise RuntimeError("R2 is not configured. Confirm env vars exist and survived restart.")


# ─────────────────────────────────────────────────────────────
# Supabase helpers
# ─────────────────────────────────────────────────────────────
def sb_get(table: str, params: Dict[str, Any]):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=HEADERS,
        params=params,
        timeout=20,
    )
    r.raise_for_status()
    return r.json() if r.text else None


def _extract_missing_column(postgrest_text: str) -> Optional[str]:
    try:
        j = json.loads(postgrest_text)
        msg = (j.get("message") or "") if isinstance(j, dict) else ""
        if "Could not find the '" in msg and "' column" in msg:
            return msg.split("Could not find the '")[1].split("'")[0]
        if "does not exist" in msg and "column" in msg and '"' in msg:
            parts = msg.split('"')
            if len(parts) >= 2:
                return parts[1]
    except Exception:
        pass
    return None


def _sanitize_params(params: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k, v in (params or {}).items():
        if k == "id":
            out[k] = sanitize_eq_filter(v, "user_loras.id")
        else:
            out[k] = CONTROL_CHARS_RE.sub("", str(v)).strip() if v is not None else v
    return out


def sb_patch_safe(table: str, payload: Dict[str, Any], params: Dict[str, Any]):
    working = dict(payload)
    safe_params = _sanitize_params(params)

    for _ in range(12):
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=HEADERS,
            json=working,
            params=safe_params,
            timeout=20,
        )

        if 200 <= r.status_code < 300:
            return r.json() if r.text else None

        if r.status_code != 400:
            r.raise_for_status()

        missing = _extract_missing_column(r.text)
        if missing:
            log(f"⚠️ Supabase missing column '{missing}' — stripping")
            working.pop(missing, None)
            continue

        raise RuntimeError(f"Supabase PATCH 400 (not missing-column). Body: {r.text}")

    raise RuntimeError("Supabase PATCH failed repeatedly (too many retries)")


# ─────────────────────────────────────────────────────────────
# Edge Function notify (terminal status only)
# ─────────────────────────────────────────────────────────────
def notify_status(job_id: str, new_status: str) -> None:
    if not LORA_NOTIFY_ENDPOINT:
        log("⚠️ LORA_NOTIFY_ENDPOINT not set — skipping notify")
        return

    payload = {"lora_id": job_id, "new_status": new_status}
    headers = {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json",
    }

    try:
        r = requests.post(LORA_NOTIFY_ENDPOINT, headers=headers, json=payload, timeout=15)
        r.raise_for_status()
        log(f"📨 Notified Edge Function: status={new_status} job={job_id}")
    except Exception as e:
        log(f"⚠️ Notify failed (non-fatal): {e}")


# ─────────────────────────────────────────────────────────────
# R2 helpers
# ─────────────────────────────────────────────────────────────
def r2_list_objects(s3, bucket: str, prefix: str) -> List[str]:
    keys: List[str] = []
    continuation: Optional[str] = None

    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix}
        if continuation:
            kwargs["ContinuationToken"] = continuation

        resp = s3.list_objects_v2(**kwargs)
        for obj in resp.get("Contents", []):
            k = obj.get("Key")
            if k:
                keys.append(k)

        if resp.get("IsTruncated"):
            continuation = resp.get("NextContinuationToken")
            continue
        break

    return keys


def r2_download_file(s3, bucket: str, key: str, local_path: str) -> None:
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    try:
        s3.download_file(bucket, key, local_path)
    except ClientError as e:
        raise RuntimeError(f"R2 download failed: s3://{bucket}/{key} -> {local_path} ({e})")


def r2_upload_artifact(s3, local_path: str, bucket: str, key: str) -> str:
    if not os.path.exists(local_path):
        raise RuntimeError(f"Artifact not found for upload: {local_path}")
    size = os.path.getsize(local_path)
    if size < ARTIFACT_MIN_BYTES:
        raise RuntimeError(f"Artifact too small for upload: {size} bytes")

    log(f"☁️ Uploading final LoRA to R2: s3://{bucket}/{key} ({size} bytes)")
    try:
        s3.upload_file(local_path, bucket, key)
    except ClientError as e:
        raise RuntimeError(f"R2 upload failed: s3://{bucket}/{key} ({e})")

    log("☁️ R2 upload complete")
    return key


# ─────────────────────────────────────────────────────────────
# Post-training cleanup (prevents disk quota issues)
# ─────────────────────────────────────────────────────────────
def cleanup_job_dirs(lora_id: Optional[str]) -> None:
    if not lora_id:
        return

    train_dir = os.path.join(LOCAL_TRAIN_ROOT, f"sf_{lora_id}")
    out_dir = os.path.join(OUTPUT_ROOT, f"sf_{lora_id}")

    for p in [train_dir, out_dir]:
        try:
            if os.path.exists(p):
                shutil.rmtree(p, ignore_errors=True)
                log(f"🧹 Cleaned local dir: {p}")
        except Exception as e:
            log(f"⚠️ Cleanup failed for {p}: {e}")


# ─────────────────────────────────────────────────────────────
# Repeat logic
# ─────────────────────────────────────────────────────────────
def compute_repeat(image_count: int) -> Tuple[int, int]:
    repeat = max(1, round(TARGET_SAMPLES / image_count))
    return repeat, image_count * repeat


# ─────────────────────────────────────────────────────────────
# Trigger token + captions
# ─────────────────────────────────────────────────────────────
def build_trigger_token(lora_id: str) -> str:
    """
    Stable token you can safely put in prompts.
    Example: sf3a93a30f (first 8 hex of uuid, no hyphens)
    """
    short = lora_id.replace("-", "")[:8].lower()
    return f"sf{short}"


def _ensure_blip_loaded() -> None:
    global _BLIP_READY, _BLIP_PROCESSOR, _BLIP_MODEL
    if _BLIP_READY:
        return

    try:
        from transformers import BlipProcessor, BlipForConditionalGeneration  # type: ignore
    except Exception as e:
        raise RuntimeError(
            "BLIP deps missing. Install: pip install transformers accelerate pillow"
        ) from e

    log(f"🧠 Loading BLIP caption model: {BLIP_MODEL_ID}")
    _BLIP_PROCESSOR = BlipProcessor.from_pretrained(BLIP_MODEL_ID)
    _BLIP_MODEL = BlipForConditionalGeneration.from_pretrained(BLIP_MODEL_ID)

    # Prefer GPU if available; otherwise CPU works (slower).
    import torch  # type: ignore
    device = "cuda" if torch.cuda.is_available() else "cpu"
    _BLIP_MODEL = _BLIP_MODEL.to(device)
    _BLIP_MODEL.eval()

    _BLIP_READY = True
    log(f"🧠 BLIP ready on device={device}")


def blip_caption(image_path: str) -> str:
    """
    Returns a short caption for the image.
    """
    _ensure_blip_loaded()
    import torch  # type: ignore

    img = Image.open(image_path).convert("RGB")
    inputs = _BLIP_PROCESSOR(images=img, return_tensors="pt")

    device = next(_BLIP_MODEL.parameters()).device
    inputs = {k: v.to(device) for k, v in inputs.items()}

    with torch.no_grad():
        out = _BLIP_MODEL.generate(
            **inputs,
            max_length=30,
            num_beams=5,
        )

    caption = _BLIP_PROCESSOR.decode(out[0], skip_special_tokens=True).strip()
    caption = re.sub(r"\s+", " ", caption)
    return caption


def write_caption(image_path: str, caption_text: str) -> None:
    root, _ = os.path.splitext(image_path)
    with open(root + CAPTION_EXTENSION, "w", encoding="utf-8") as f:
        f.write(caption_text)


def build_caption(trigger_token: str, image_path: str) -> str:
    """
    Build the final caption saved to <image>.txt
    Format:
      <trigger> <suffix>, <optional style prefix>, <blip caption>
    """
    base_prefix = f"{trigger_token} {TRIGGER_SUFFIX}".strip()

    if not USE_BLIP_CAPTIONS:
        # Fallback: old behavior (not ideal for identity lock, but safe)
        if CAPTION_STYLE_PREFIX:
            return f"{base_prefix}, {CAPTION_STYLE_PREFIX}".strip(", ")
        return base_prefix

    cap = blip_caption(image_path)

    parts = [base_prefix]
    if CAPTION_STYLE_PREFIX:
        parts.append(CAPTION_STYLE_PREFIX)
    if cap:
        parts.append(cap)

    return ", ".join([p.strip() for p in parts if p.strip()])


# ─────────────────────────────────────────────────────────────
# Dataset builder
# ─────────────────────────────────────────────────────────────
def prepare_dataset(lora_id: str) -> Dict[str, Any]:
    s3 = make_r2_client()

    base = os.path.join(LOCAL_TRAIN_ROOT, f"sf_{lora_id}")
    shutil.rmtree(base, ignore_errors=True)
    os.makedirs(base, exist_ok=True)

    prefix = f"{R2_DATASET_PREFIX_ROOT}/{lora_id}/".replace("//", "/")
    keys = r2_list_objects(s3, R2_DATASET_BUCKET, prefix)
    if not keys:
        raise RuntimeError(f"No files found in R2 for this job: s3://{R2_DATASET_BUCKET}/{prefix}")

    tmp = os.path.join(base, "_tmp")
    os.makedirs(tmp, exist_ok=True)

    for key in keys:
        filename = os.path.basename(key)
        if not filename:
            continue
        local_path = os.path.join(tmp, filename)
        r2_download_file(s3, R2_DATASET_BUCKET, key, local_path)

    images = [f for f in os.listdir(tmp) if f.lower().endswith(IMAGE_EXTS)]
    count = len(images)

    if not (MIN_IMAGES <= count <= MAX_IMAGES):
        raise RuntimeError(f"Invalid image count: {count} (expected {MIN_IMAGES}-{MAX_IMAGES})")

    repeat, effective = compute_repeat(count)

    trigger_token = build_trigger_token(lora_id)
    # Dataset folder naming should not include spaces.
    concept_dir = os.path.join(base, f"{repeat}_{trigger_token}")
    os.makedirs(concept_dir, exist_ok=True)

    # Write per-image captions
    captions_written = 0
    for img in images:
        src = os.path.join(tmp, img)
        dst = os.path.join(concept_dir, img)
        shutil.move(src, dst)

        cap = build_caption(trigger_token, dst)
        write_caption(dst, cap)
        captions_written += 1

    shutil.rmtree(tmp, ignore_errors=True)

    # Persist debug metadata
    meta = {
        "lora_id": lora_id,
        "trigger_token": trigger_token,
        "use_blip": USE_BLIP_CAPTIONS,
        "blip_model": BLIP_MODEL_ID if USE_BLIP_CAPTIONS else None,
        "trigger_suffix": TRIGGER_SUFFIX,
        "caption_style_prefix": CAPTION_STYLE_PREFIX,
        "image_count": count,
        "repeat": repeat,
        "effective_samples": effective,
        "r2_bucket": R2_DATASET_BUCKET,
        "r2_prefix": prefix,
    }
    with open(os.path.join(base, "dataset_meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    log(f"📦 R2 dataset: bucket={R2_DATASET_BUCKET} prefix={prefix} files={len(keys)}")
    log(f"📊 Images={count} → repeat={repeat} → samples≈{effective}")
    log(f"🏷️ Trigger token: {trigger_token}  (THIS is what you will prompt with)")
    log(f"📝 Captions written: {captions_written}  (BLIP={USE_BLIP_CAPTIONS})")

    return {
        "base_dir": base,
        "steps": effective,
        "image_count": count,
        "repeat": repeat,
        "r2_prefix": prefix,
        "trigger_token": trigger_token,
    }


# ─────────────────────────────────────────────────────────────
# Training
# ─────────────────────────────────────────────────────────────
def run_training(lora_id: str, ds: Dict[str, Any]) -> str:
    out = os.path.join(OUTPUT_ROOT, f"sf_{lora_id}")
    os.makedirs(out, exist_ok=True)

    name = f"sf_{lora_id}"
    artifact = os.path.join(out, f"{name}.safetensors")

    cmd = [
        PYTHON_BIN,
        TRAIN_SCRIPT,
        "--pretrained_model_name_or_path",
        PRETRAINED_MODEL,
        "--vae",
        VAE_PATH,
        "--train_data_dir",
        ds["base_dir"],
        "--caption_extension",
        CAPTION_EXTENSION,
        "--output_dir",
        out,
        "--output_name",
        name,
        "--network_module",
        NETWORK_MODULE,
        "--resolution",
        "1024,1024",
        "--enable_bucket",
        "--min_bucket_reso",
        "512",
        "--max_bucket_reso",
        "1024",
        "--bucket_reso_steps",
        "64",
        "--train_batch_size",
        "1",
        "--learning_rate",
        "1e-4",
        "--max_train_steps",
        str(ds["steps"]),
        "--network_dim",
        "64",
        "--network_alpha",
        "32",
        "--mixed_precision",
        "fp16",
        "--gradient_checkpointing",
        "--save_model_as",
        "safetensors",
        "--save_every_n_steps",
        "200",
    ]

    log("🔥 Starting training")
    log("CMD: " + " ".join(cmd))

    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if not p.stdout:
        raise RuntimeError("Training process failed to start")

    for line in p.stdout:
        print(line, end="")

    if p.wait() != 0:
        raise RuntimeError("Training failed")

    if not os.path.exists(artifact) or os.path.getsize(artifact) < ARTIFACT_MIN_BYTES:
        raise RuntimeError("Invalid artifact produced")

    log(f"✅ Artifact created: {artifact}")
    return artifact


# ─────────────────────────────────────────────────────────────
# Worker loop
# ─────────────────────────────────────────────────────────────
def worker_main() -> None:
    sanity_checks()

    log("🚀 LoRA worker started (PRODUCTION) — QUEUED ONLY + user_id NOT NULL")
    log(f"R2_DATASET_BUCKET={R2_DATASET_BUCKET}  R2_DATASET_PREFIX_ROOT={R2_DATASET_PREFIX_ROOT}")
    log(f"R2_ARTIFACT_BUCKET={R2_ARTIFACT_BUCKET}  R2_ARTIFACT_PREFIX_ROOT={R2_ARTIFACT_PREFIX_ROOT}")
    log(f"📝 Captioning: BLIP={USE_BLIP_CAPTIONS} model={BLIP_MODEL_ID if USE_BLIP_CAPTIONS else 'OFF'}")

    last_idle = 0.0

    while True:
        lora_id: Optional[str] = None
        artifact_uploaded: bool = False
        uploaded_r2_key: Optional[str] = None

        try:
            jobs = sb_get(
                "user_loras",
                {
                    "status": "eq.queued",
                    "user_id": "not.is.null",
                    "order": "created_at.asc",
                    "limit": 1,
                },
            )

            if not jobs:
                if time.time() - last_idle >= IDLE_LOG_SECONDS:
                    log("⏳ No queued jobs (with user_id) — waiting")
                    last_idle = time.time()
                time.sleep(POLL_SECONDS)
                continue

            raw_id = jobs[0].get("id")
            log(f"📥 Raw job id repr: {repr(str(raw_id))}")

            lora_id = sanitize_uuid(raw_id, "user_loras.id")
            log(f"📥 Picked queued job {lora_id}")

            sb_patch_safe("user_loras", {"status": "training", "progress": 1}, {"id": f"eq.{lora_id}"})

            ds = prepare_dataset(lora_id)
            local_artifact = run_training(lora_id, ds)

            s3 = make_r2_client()
            uploaded_r2_key = f"{R2_ARTIFACT_PREFIX_ROOT}/{lora_id}/final.safetensors".replace("//", "/")
            r2_upload_artifact(s3, local_artifact, R2_ARTIFACT_BUCKET, uploaded_r2_key)
            artifact_uploaded = True

            completed_payload = {
                "status": "completed",
                "progress": 100,
                "artifact_r2_bucket": R2_ARTIFACT_BUCKET,
                "artifact_r2_key": uploaded_r2_key,
                "dataset_r2_bucket": R2_DATASET_BUCKET,
                "dataset_r2_prefix": ds.get("r2_prefix"),
                "image_count": ds.get("image_count"),
                # Optional: store trigger_token if column exists; sb_patch_safe will strip if not.
                "trigger_token": ds.get("trigger_token"),
            }

            try:
                sb_patch_safe("user_loras", completed_payload, {"id": f"eq.{lora_id}"})
            except Exception as patch_err:
                log(f"⚠️ Artifact is safe in R2 but Supabase update failed: {patch_err}")
                try:
                    sb_patch_safe(
                        "user_loras",
                        {
                            "status": "completed",
                            "progress": 100,
                            "artifact_r2_bucket": R2_ARTIFACT_BUCKET,
                            "artifact_r2_key": uploaded_r2_key,
                        },
                        {"id": f"eq.{lora_id}"},
                    )
                except Exception as patch_err_2:
                    log(f"⚠️ Minimal Supabase update also failed (artifact still safe): {patch_err_2}")

            notify_status(lora_id, "completed")
            log(f"✅ Completed job {lora_id}")

            cleanup_job_dirs(lora_id)

        except Exception as e:
            if artifact_uploaded and lora_id and uploaded_r2_key:
                log(f"⚠️ Error AFTER artifact upload. Leaving as completed. Error: {e}")
                cleanup_job_dirs(lora_id)
                time.sleep(POLL_SECONDS)
                continue

            try:
                if lora_id:
                    sb_patch_safe(
                        "user_loras",
                        {"status": "failed", "progress": 0, "error_message": str(e)},
                        {"id": f"eq.{lora_id}"},
                    )
                    notify_status(lora_id, "failed")
            except Exception as pe:
                log(f"⚠️ Failed to patch failure status: {pe}")

            log(f"❌ Job failed: {e}")

            cleanup_job_dirs(lora_id)

            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    worker_main()
PY
