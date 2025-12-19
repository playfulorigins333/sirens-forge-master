"""
SirensForge — LoRA Cache Helper (Launch Version)

Responsibility:
- Ensure a LoRA file exists locally on the pod
- Download once via signed URL
- Reuse cached LoRA for subsequent generations

Design goals:
- Pod-safe (no git, no rebuilds)
- Idempotent
- One LoRA per request (launch rule)
- Works for image + future video pods
"""

import os
import shutil
import tempfile
import requests
from typing import Optional

# ---------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------

LORA_CACHE_DIR = "/workspace/cache/loras"
DOWNLOAD_TIMEOUT = 60  # seconds
CHUNK_SIZE = 1024 * 1024  # 1MB


# ---------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------

def ensure_cache_dir() -> None:
    """
    Ensure the LoRA cache directory exists.
    """
    os.makedirs(LORA_CACHE_DIR, exist_ok=True)


def lora_local_path(filename: str) -> str:
    """
    Resolve the absolute local path for a cached LoRA.
    """
    return os.path.join(LORA_CACHE_DIR, filename)


def is_cached(filename: str) -> bool:
    """
    Check if a LoRA file already exists locally.
    """
    path = lora_local_path(filename)
    return os.path.isfile(path) and os.path.getsize(path) > 0


# ---------------------------------------------------------------------
# CORE API
# ---------------------------------------------------------------------

def ensure_lora_cached(
    *,
    filename: str,
    signed_url: str,
    expected_size_bytes: Optional[int] = None,
) -> str:
    """
    Ensure the given LoRA file exists locally.

    Args:
        filename: Target filename (e.g. sf_<lora_id>.safetensors)
        signed_url: Supabase signed download URL
        expected_size_bytes: Optional safety check

    Returns:
        Absolute local path to the cached LoRA file.

    Raises:
        RuntimeError if download fails or file is invalid.
    """
    ensure_cache_dir()

    final_path = lora_local_path(filename)

    # Fast path: already cached
    if is_cached(filename):
        return final_path

    # Download to a temp file first (atomic write)
    with tempfile.NamedTemporaryFile(
        dir=LORA_CACHE_DIR,
        prefix=f".tmp_{filename}_",
        delete=False,
    ) as tmp_file:
        tmp_path = tmp_file.name

        try:
            with requests.get(
                signed_url,
                stream=True,
                timeout=DOWNLOAD_TIMEOUT,
            ) as response:
                response.raise_for_status()

                total_written = 0

                for chunk in response.iter_content(chunk_size=CHUNK_SIZE):
                    if chunk:
                        tmp_file.write(chunk)
                        total_written += len(chunk)

                tmp_file.flush()
                os.fsync(tmp_file.fileno())

            # Optional size validation
            if expected_size_bytes is not None:
                if total_written != expected_size_bytes:
                    raise RuntimeError(
                        f"LoRA size mismatch for {filename}: "
                        f"expected {expected_size_bytes}, got {total_written}"
                    )

            if total_written == 0:
                raise RuntimeError(f"Downloaded LoRA is empty: {filename}")

            # Atomic move into place
            shutil.move(tmp_path, final_path)

        except Exception as e:
            # Cleanup temp file on failure
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except Exception:
                pass
            raise RuntimeError(f"Failed to cache LoRA {filename}: {e}") from e

    return final_path
