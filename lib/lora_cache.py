# /workspace/sirensforge/lib/lora_cache.py
# ------------------------------------------------------------
# LoRA Artifact Cache (Launch-Safe)
# - Downloads LoRA from Supabase Storage once
# - Caches locally in /workspace/cache/loras
# - Safe for concurrent generation requests
# ------------------------------------------------------------

import os
import shutil
import tempfile
from supabase import create_client

# ------------------------------------------------------------
# ENV
# ------------------------------------------------------------

SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

LORA_CACHE_DIR = "/workspace/cache/loras"

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("Supabase environment variables not set")

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# ------------------------------------------------------------
# PUBLIC API
# ------------------------------------------------------------

def get_lora_path(
    *,
    bucket: str,
    storage_path: str,
    lora_id: str,
) -> str:
    """
    Ensure LoRA exists locally and return absolute file path.

    Args:
        bucket: Supabase storage bucket name
        storage_path: Path inside bucket (e.g. loras/foo.safetensors)
        lora_id: Stable LoRA identifier (used for local filename)

    Returns:
        Absolute path to cached .safetensors file
    """

    os.makedirs(LORA_CACHE_DIR, exist_ok=True)

    filename = f"{lora_id}.safetensors"
    final_path = os.path.join(LORA_CACHE_DIR, filename)

    # Fast path: already cached
    if os.path.exists(final_path):
        return final_path

    # --------------------------------------------------------
    # Download with atomic write
    # --------------------------------------------------------

    tmp_fd, tmp_path = tempfile.mkstemp(
        prefix=f".{lora_id}.",
        suffix=".tmp",
        dir=LORA_CACHE_DIR,
    )
    os.close(tmp_fd)

    try:
        # Download from Supabase Storage
        response = supabase.storage.from_(bucket).download(storage_path)

        if not response:
            raise RuntimeError(f"Failed to download LoRA: {storage_path}")

        with open(tmp_path, "wb") as f:
            f.write(response)

        # Atomic replace
        os.replace(tmp_path, final_path)

        return final_path

    except Exception:
        # Cleanup temp file if something fails
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass
        raise
