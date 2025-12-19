import os
import requests
from typing import Optional

# ─────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

ARTIFACT_BUCKET = os.getenv("LORA_ARTIFACT_BUCKET", "lora-artifacts")
CACHE_ROOT = os.getenv("LORA_CACHE_ROOT", "/workspace/lora_cache")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────
def _signed_download_url(storage_path: str) -> str:
    """
    Create a short-lived signed URL for the artifact in Supabase Storage.
    """
    url = f"{SUPABASE_URL}/storage/v1/object/sign/{ARTIFACT_BUCKET}/{storage_path}"
    r = requests.post(url, headers=HEADERS, json={"expiresIn": 3600}, timeout=20)
    r.raise_for_status()
    signed = r.json()["signedURL"]
    return f"{SUPABASE_URL}/storage/v1{signed}" if signed.startswith("/") else signed


def _ensure_cache_dir() -> None:
    os.makedirs(CACHE_ROOT, exist_ok=True)


# ─────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────
def ensure_lora_cached(
    job_id: str,
    artifact_storage_path: str,
) -> str:
    """
    Ensure the LoRA for job_id exists locally.
    Downloads from Supabase Storage once per pod if missing.

    Returns local filesystem path to the .safetensors file.
    """
    _ensure_cache_dir()

    local_path = os.path.join(CACHE_ROOT, f"{job_id}.safetensors")

    # Cache hit
    if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
        return local_path

    # Cache miss → download
    signed_url = _signed_download_url(artifact_storage_path)

    with requests.get(signed_url, stream=True, timeout=300) as r:
        r.raise_for_status()
        with open(local_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)

    # Basic validation
    if os.path.getsize(local_path) < 1024 * 1024:
        raise RuntimeError(f"Downloaded LoRA is suspiciously small: {local_path}")

    return local_path
