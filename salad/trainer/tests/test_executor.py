import argparse
import hashlib
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

MODULE_PATH = Path(__file__).parents[1] / "executor.py"
spec = importlib.util.spec_from_file_location("trainer_executor", MODULE_PATH)
executor = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(executor)

IDENTITY = "12345678-1234-4234-8234-123456789abc"
JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
ATTEMPT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


class ValidationTests(unittest.TestCase):
    def test_canonical_uuid(self):
        self.assertEqual(executor.canonical_uuid(IDENTITY), IDENTITY)
        for invalid in (IDENTITY.upper(), "{12345678-1234-4234-8234-123456789abc}", "not-a-uuid"):
            with self.assertRaises(argparse.ArgumentTypeError):
                executor.canonical_uuid(invalid)

    def test_lowercase_hash(self):
        self.assertEqual(executor.lowercase_sha256("a" * 64), "a" * 64)
        for invalid in ("A" * 64, "a" * 63, "g" * 64):
            with self.assertRaises(argparse.ArgumentTypeError):
                executor.lowercase_sha256(invalid)

    def test_hash_verification_accepts_correct_hash(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "model"
            path.write_bytes(b"model")
            expected = hashlib.sha256(b"model").hexdigest()
            self.assertEqual(executor.verify_file(path, expected, "model"), path.resolve())

    def test_model_hash_failures_precede_subprocess(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            base = root / "base"; base.write_bytes(b"base")
            vae = root / "vae"; vae.write_bytes(b"vae")
            common = dict(identity_id=IDENTITY, job_id=JOB, attempt_id=ATTEMPT,
                dataset_dir=root, base_model=base, vae=vae, checkpoint_dir=root / "cp",
                output_dir=root / "out", sd_scripts_dir=root, caption_style_prefix="")
            for field in ("base_model_sha256", "vae_sha256"):
                values = dict(common, base_model_sha256=hashlib.sha256(b"base").hexdigest(),
                              vae_sha256=hashlib.sha256(b"vae").hexdigest())
                values[field] = "0" * 64
                with self.subTest(field=field), mock.patch.object(executor.subprocess, "run") as run:
                    with self.assertRaises(executor.ExecutorError):
                        executor.execute(argparse.Namespace(**values))
                    run.assert_not_called()


class DatasetTests(unittest.TestCase):
    def make_images(self, root, count):
        for index in range(count):
            (root / f"image-{index:02d}.jpg").write_bytes(b"x")

    def test_image_count_bounds(self):
        for count, accepted in ((9, False), (10, True), (20, True), (21, False)):
            with self.subTest(count=count), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); self.make_images(root, count)
                if accepted:
                    self.assertEqual(len(executor.enumerate_images(root)), count)
                else:
                    with self.assertRaises(executor.ExecutorError): executor.enumerate_images(root)

    def test_extensions_nested_files_and_sorting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            names = ["z.webp", "A.PNG", "c.jpeg", "b.jpg"] + [f"m{i}.jpg" for i in range(6)]
            for name in reversed(names): (root / name).write_bytes(b"x")
            (root / "ignored.gif").write_bytes(b"x")
            nested = root / "nested"; nested.mkdir(); (nested / "hidden.jpg").write_bytes(b"x")
            result = executor.enumerate_images(root)
            self.assertEqual([path.name for path in result], sorted(names))
            self.assertNotIn(nested / "hidden.jpg", result)

    def test_supported_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self.make_images(root, 10)
            (root / "linked.png").symlink_to(root / "image-00.jpg")
            with self.assertRaises(executor.ExecutorError): executor.enumerate_images(root)

    def test_repeat_trigger_and_captions(self):
        self.assertEqual(executor.repeat_count(10), 120)
        self.assertEqual(executor.repeat_count(20), 60)
        self.assertEqual(executor.trigger_token(IDENTITY), "sf12345678")
        self.assertEqual(executor.assemble_caption("sf12345678"), "sf12345678 woman")
        self.assertEqual(executor.assemble_caption("sf12345678", "smiling"), "sf12345678 woman, smiling")
        self.assertEqual(executor.assemble_caption("sf12345678", "smiling", "cinematic"),
                         "sf12345678 woman, cinematic, smiling")


class CommandAndArtifactTests(unittest.TestCase):
    def test_quality_state_and_resume_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); name = executor.stable_output_name(IDENTITY, ATTEMPT)
            for candidate in (f"{name}-step00000200-state", f"{name}-step00000400-state",
                              f"{name}-state", f"other-step99999999-state", f"{name}-step400-state"):
                (root / candidate).mkdir()
            command = executor.build_training_command(root, root/"base", root/"vae", root/"data", root, name, 1200)
            expected_pairs = {
                "--pretrained_model_name_or_path": str(root/"base"), "--vae": str(root/"vae"),
                "--train_data_dir": str(root/"data"), "--caption_extension": ".txt",
                "--output_dir": str(root), "--output_name": name, "--network_module": "networks.lora",
                "--resolution": "1024,1024", "--min_bucket_reso": "512", "--max_bucket_reso": "1024",
                "--bucket_reso_steps": "64", "--train_batch_size": "1", "--learning_rate": "1e-4",
                "--max_train_steps": "1200", "--network_dim": "64", "--network_alpha": "32",
                "--mixed_precision": "fp16", "--save_model_as": "safetensors",
                "--save_every_n_steps": "200", "--save_last_n_steps_state": "400",
            }
            for flag, value in expected_pairs.items(): self.assertEqual(command[command.index(flag)+1], value)
            for flag in ("--enable_bucket", "--gradient_checkpointing", "--save_state", "--save_state_on_train_end"):
                self.assertIn(flag, command)
            self.assertEqual(command[command.index("--resume")+1], str((root/f"{name}-step00000400-state").resolve()))

    def test_no_checkpoint_means_no_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            command = executor.build_training_command(root, root/"b", root/"v", root/"d", root, "name", 1)
            self.assertNotIn("--resume", command)

    def test_final_artifact_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); output = root / "output"; source = root / "result.safetensors"
            with self.assertRaises(executor.ExecutorError): executor.publish_final_artifact(source, output)
            source.write_bytes(b"x" * executor.MIN_FINAL_BYTES)
            with self.assertRaises(executor.ExecutorError): executor.publish_final_artifact(source, output)
            source.write_bytes(b"x" * (executor.MIN_FINAL_BYTES + 1)); output.mkdir(); (output/"old.log").write_text("old")
            final = executor.publish_final_artifact(source, output)
            self.assertEqual(final.name, "final.safetensors")
            self.assertEqual([item.name for item in output.iterdir()], ["final.safetensors"])

    def test_nonzero_subprocess_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dataset = root / "dataset"; dataset.mkdir()
            for index in range(10): (dataset / f"{index}.jpg").write_bytes(b"x")
            base = root / "base"; base.write_bytes(b"base")
            vae = root / "vae"; vae.write_bytes(b"vae")
            scripts = root / "scripts"; scripts.mkdir(); (scripts / "sdxl_train_network.py").write_text("")
            args = argparse.Namespace(identity_id=IDENTITY, job_id=JOB, attempt_id=ATTEMPT,
                dataset_dir=dataset, base_model=base, base_model_sha256=hashlib.sha256(b"base").hexdigest(),
                vae=vae, vae_sha256=hashlib.sha256(b"vae").hexdigest(), checkpoint_dir=root/"cp",
                output_dir=root/"out", sd_scripts_dir=scripts, caption_style_prefix="")
            prepared = root / "prepared"; prepared.mkdir()
            with mock.patch.object(executor, "prepare_dataset", return_value=(prepared, 120)), \
                 mock.patch.object(executor.subprocess, "run", return_value=subprocess.CompletedProcess([], 17)):
                with self.assertRaisesRegex(executor.ExecutorError, "status 17"):
                    executor.execute(args)


if __name__ == "__main__":
    unittest.main()
