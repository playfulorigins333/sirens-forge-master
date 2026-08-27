#!/usr/bin/env python3
"""Local-only SDXL LoRA trainer executor for a Kelpie-managed container."""

from __future__ import annotations

import argparse
import gc
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid
from typing import Callable, Sequence


SUPPORTED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
MIN_IMAGES = 10
MAX_IMAGES = 20
MIN_FINAL_BYTES = 2 * 1024 * 1024
BLIP_MODEL = "Salesforce/blip-image-captioning-base"
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class ExecutorError(RuntimeError):
    """A validated, creator-safe executor failure."""


def canonical_uuid(value: str) -> str:
    if not UUID_PATTERN.fullmatch(value):
        raise argparse.ArgumentTypeError("must be a canonical lowercase UUID")
    try:
        if str(uuid.UUID(value)) != value:
            raise ValueError
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be a canonical lowercase UUID") from exc
    return value


def lowercase_sha256(value: str) -> str:
    if not HASH_PATTERN.fullmatch(value):
        raise argparse.ArgumentTypeError("must be exactly 64 lowercase hexadecimal characters")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_file(path: Path, expected_hash: str, label: str) -> Path:
    resolved = path.resolve(strict=True)
    if path.is_symlink() or not resolved.is_file():
        raise ExecutorError(f"{label} must be a regular, non-symlink file")
    if sha256_file(resolved) != expected_hash:
        raise ExecutorError(f"{label} SHA256 mismatch")
    return resolved


def existing_directory(path: Path, label: str) -> Path:
    resolved = path.resolve(strict=True)
    if path.is_symlink() or not resolved.is_dir():
        raise ExecutorError(f"{label} must be a regular, non-symlink directory")
    return resolved


def writable_directory(path: Path, label: str) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return existing_directory(path, label)


def enumerate_images(dataset_dir: Path) -> list[Path]:
    dataset_dir = existing_directory(dataset_dir, "dataset directory")
    images: list[Path] = []
    for entry in dataset_dir.iterdir():
        if entry.suffix.lower() not in SUPPORTED_IMAGE_SUFFIXES:
            continue
        if entry.is_symlink() or not entry.is_file():
            raise ExecutorError(f"supported image entry is not a regular file: {entry.name}")
        images.append(entry)
    images.sort(key=lambda item: item.name)
    if not MIN_IMAGES <= len(images) <= MAX_IMAGES:
        raise ExecutorError(f"dataset must contain {MIN_IMAGES}-{MAX_IMAGES} direct image files")
    return images


def repeat_count(image_count: int) -> int:
    if image_count <= 0:
        raise ValueError("image count must be positive")
    return max(1, round(1200 / image_count))


def trigger_token(identity_id: str) -> str:
    canonical_uuid(identity_id)
    return "sf" + uuid.UUID(identity_id).hex[:8]


def assemble_caption(trigger: str, blip_caption: str = "", style_prefix: str = "") -> str:
    parts = [f"{trigger} woman"]
    parts.extend(value.strip() for value in (style_prefix, blip_caption) if value.strip())
    return ", ".join(parts)


def load_blip_captioner() -> tuple[Callable[[Path], str], Callable[[], None]]:
    """Import heavyweight ML packages only when caption generation begins."""
    import torch
    from PIL import Image
    from transformers import BlipForConditionalGeneration, BlipProcessor

    device = "cuda" if torch.cuda.is_available() else "cpu"
    processor = BlipProcessor.from_pretrained(BLIP_MODEL)
    model = BlipForConditionalGeneration.from_pretrained(BLIP_MODEL).to(device)

    def caption(path: Path) -> str:
        with Image.open(path) as image:
            inputs = processor(images=image.convert("RGB"), return_tensors="pt").to(device)
        result = model.generate(**inputs, max_length=30, num_beams=5)
        return processor.decode(result[0], skip_special_tokens=True).strip()

    def release() -> None:
        nonlocal processor, model
        processor = None
        model = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    return caption, release


def prepare_dataset(
    images: Sequence[Path], work_root: Path, trigger: str, style_prefix: str = "",
    captioner_factory: Callable[[], tuple[Callable[[Path], str], Callable[[], None]]] = load_blip_captioner,
) -> tuple[Path, int]:
    repeats = repeat_count(len(images))
    prepared_root = work_root / "dataset"
    if prepared_root.exists():
        shutil.rmtree(prepared_root)
    concept_dir = prepared_root / f"{repeats}_{trigger}"
    concept_dir.mkdir(parents=True)
    captioner, release = captioner_factory()
    try:
        for index, source in enumerate(images):
            destination = concept_dir / f"{index:03d}{source.suffix.lower()}"
            shutil.copyfile(source, destination, follow_symlinks=False)
            destination.with_suffix(".txt").write_text(
                assemble_caption(trigger, captioner(source), style_prefix) + "\n", encoding="utf-8"
            )
    finally:
        release()
    return prepared_root, repeats


def stable_output_name(identity_id: str, attempt_id: str) -> str:
    return f"trainer-{identity_id}-{attempt_id}"


def highest_resume_state(checkpoint_dir: Path, output_name: str) -> Path | None:
    pattern = re.compile(rf"^{re.escape(output_name)}-step([0-9]{{8}})-state$")
    candidates: list[tuple[int, Path]] = []
    for entry in checkpoint_dir.iterdir():
        match = pattern.fullmatch(entry.name)
        if match and not entry.is_symlink() and entry.is_dir():
            candidates.append((int(match.group(1)), entry.resolve()))
    return max(candidates, default=(0, None), key=lambda item: item[0])[1]


def build_training_command(
    sd_scripts_dir: Path, base_model: Path, vae: Path, prepared_root: Path,
    checkpoint_dir: Path, output_name: str, max_steps: int,
) -> list[str]:
    command = [
        sys.executable, str(sd_scripts_dir / "sdxl_train_network.py"),
        "--pretrained_model_name_or_path", str(base_model), "--vae", str(vae),
        "--train_data_dir", str(prepared_root), "--caption_extension", ".txt",
        "--output_dir", str(checkpoint_dir), "--output_name", output_name,
        "--network_module", "networks.lora", "--resolution", "1024,1024",
        "--enable_bucket", "--min_bucket_reso", "512", "--max_bucket_reso", "1024",
        "--bucket_reso_steps", "64", "--train_batch_size", "1",
        "--learning_rate", "1e-4", "--max_train_steps", str(max_steps),
        "--network_dim", "64", "--network_alpha", "32", "--mixed_precision", "fp16",
        "--gradient_checkpointing", "--save_model_as", "safetensors",
        "--save_state", "--save_every_n_steps", "200",
        "--save_last_n_steps_state", "400", "--save_state_on_train_end",
    ]
    resume = highest_resume_state(checkpoint_dir, output_name)
    if resume is not None:
        command.extend(["--resume", str(resume)])
    return command


def publish_final_artifact(source: Path, output_dir: Path) -> Path:
    if source.is_symlink() or not source.is_file():
        raise ExecutorError("expected final training artifact is missing or invalid")
    if source.stat().st_size <= MIN_FINAL_BYTES:
        raise ExecutorError("final training artifact must be larger than 2 MiB")
    output_dir = writable_directory(output_dir, "output directory")
    for entry in output_dir.iterdir():
        if entry.is_dir() and not entry.is_symlink():
            shutil.rmtree(entry)
        else:
            entry.unlink()
    temporary = output_dir / ".final.safetensors.tmp"
    final = output_dir / "final.safetensors"
    shutil.copyfile(source, temporary, follow_symlinks=False)
    os.replace(temporary, final)
    entries = list(output_dir.iterdir())
    if entries != [final] or final.is_symlink() or not final.is_file():
        raise ExecutorError("final output invariant failed")
    return final


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--identity-id", required=True, type=canonical_uuid)
    result.add_argument("--job-id", required=True, type=canonical_uuid)
    result.add_argument("--attempt-id", required=True, type=canonical_uuid)
    result.add_argument("--dataset-dir", required=True, type=Path)
    result.add_argument("--base-model", required=True, type=Path)
    result.add_argument("--base-model-sha256", required=True, type=lowercase_sha256)
    result.add_argument("--vae", required=True, type=Path)
    result.add_argument("--vae-sha256", required=True, type=lowercase_sha256)
    result.add_argument("--checkpoint-dir", required=True, type=Path)
    result.add_argument("--output-dir", required=True, type=Path)
    result.add_argument("--sd-scripts-dir", required=True, type=Path)
    result.add_argument("--caption-style-prefix", default="")
    return result


def execute(args: argparse.Namespace) -> Path:
    # Hashes are deliberately verified before dataset preparation loads BLIP.
    base_model = verify_file(args.base_model, args.base_model_sha256, "base model")
    vae = verify_file(args.vae, args.vae_sha256, "VAE")
    dataset_dir = existing_directory(args.dataset_dir, "dataset directory")
    sd_scripts_dir = existing_directory(args.sd_scripts_dir, "sd-scripts directory")
    script = sd_scripts_dir / "sdxl_train_network.py"
    if script.is_symlink() or not script.is_file():
        raise ExecutorError("sdxl_train_network.py is missing or invalid")
    checkpoint_dir = writable_directory(args.checkpoint_dir, "checkpoint directory")
    output_dir = writable_directory(args.output_dir, "output directory")
    if len(args.caption_style_prefix) > 80 or "\n" in args.caption_style_prefix:
        raise ExecutorError("caption style prefix must be a single line of at most 80 characters")

    images = enumerate_images(dataset_dir)
    output_name = stable_output_name(args.identity_id, args.attempt_id)
    work_root = checkpoint_dir.parent / f".trainer-work-{args.attempt_id}"
    work_root.mkdir(parents=True, exist_ok=True)
    prepared_root, repeats = prepare_dataset(
        images, work_root, trigger_token(args.identity_id), args.caption_style_prefix
    )
    command = build_training_command(
        sd_scripts_dir, base_model, vae, prepared_root, checkpoint_dir,
        output_name, len(images) * repeats,
    )
    completed = subprocess.run(command, check=False)
    if completed.returncode != 0:
        raise ExecutorError(f"sd-scripts exited with status {completed.returncode}")
    return publish_final_artifact(checkpoint_dir / f"{output_name}.safetensors", output_dir)


def main(argv: Sequence[str] | None = None) -> int:
    try:
        execute(parser().parse_args(argv))
        return 0
    except (ExecutorError, OSError) as exc:
        print(f"trainer executor failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
