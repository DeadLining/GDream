import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts" / "validate.py"
def valid_timeline() -> dict:
    action = {
        "time": "00:00.000-00:01.000",
        "start_state": "start",
        "primary_action": "act",
        "contact_or_path": "path",
        "visible_result": "result",
        "exit_state": "end",
        "camera_visibility": "visible",
        "sound": "sound",
    }
    return {
        "creative_intent": "test",
        "duration": "1 seconds",
        "mode": "FL2VA",
        "subjects_and_objects": {"subject": "one"},
        "world_and_spatial_anchors": "one room",
        "action_timeline": [action],
        "continuity_contract": ["one subject"],
        "warnings": [],
    }


def valid_prompt() -> dict:
    return {
        "mode": "FL2VA",
        "duration": "1 seconds",
        "prompt": (
            "How the reference pictures align with the target video — Picture 1 "
            "aligns with the 0.00-second mark; Picture 2 aligns with the 1.00-second mark.\n\n"
            "integrated_multimodal_description: [Shot 1] action\n\n"
            "overall_soundscape: room tone\n\n"
            "non_diegetic_music: N/A"
        )
    }


class TimelineValidatorTests(unittest.TestCase):
    def run_validator(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(VALIDATOR), *args],
            text=True,
            capture_output=True,
            check=False,
        )

    def test_current_beat02_artifacts_pass(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            timeline = Path(directory) / "timeline.json"
            prompt = Path(directory) / "prompt.json"
            timeline.write_text(json.dumps(valid_timeline()), encoding="utf-8")
            prompt.write_text(json.dumps(valid_prompt()), encoding="utf-8")
            result = self.run_validator(
                "--timeline", str(timeline), "--prompt", str(prompt), "--mode", "FL2VA"
            )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_gap_is_rejected(self) -> None:
        data = valid_timeline()
        data["action_timeline"].append({**data["action_timeline"][0], "time": "00:02.000-00:03.000"})
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "gap.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            result = self.run_validator("--timeline", str(path))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("gap", result.stderr)

    def test_overlap_is_rejected(self) -> None:
        data = valid_timeline()
        data["action_timeline"].append({**data["action_timeline"][0], "time": "00:00.500-00:01.000"})
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "overlap.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            result = self.run_validator("--timeline", str(path))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("overlap", result.stderr)

    def test_prompt_requires_fl2va_alignment(self) -> None:
        data = valid_prompt()
        data["prompt"] = data["prompt"].replace("Picture 2", "Ending image", 1)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "prompt.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            result = self.run_validator("--prompt", str(path), "--mode", "FL2VA")
        self.assertNotEqual(result.returncode, 0)

    def check_prompt(self, data: dict) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "prompt.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            return self.run_validator("--prompt", str(path))

    def test_reference_envelope_passes(self) -> None:
        data = {
            "mode": "REF2VA", "duration": "4 seconds",
            "prompt": (
                "subject_definitions: <Subject 1> from <Picture 1>.\n"
                "summary: [reference generation] A silent action.\n"
                "retention_analysis: Identity is fully_preserved.\n"
                "detailed_description: [Shot 1] She turns.\n"
                "overall_soundscape: Room tone.\n"
                "non_diegetic_music: N/A"
            ),
        }
        result = self.check_prompt(data)
        self.assertEqual(result.returncode, 0, result.stderr)
        data["prompt"] = "She turns toward the door."
        self.assertNotEqual(self.check_prompt(data).returncode, 0)

    def test_fields_and_shot_numbers_are_enforced(self) -> None:
        source = valid_prompt()
        for prompt in (
            source["prompt"].replace("overall_soundscape: room tone", "overall_soundscape:"),
            source["prompt"] + "\noverall_soundscape: another sound",
            source["prompt"].replace("[Shot 1]", "[Shot 2]"),
            source["prompt"].replace("[Shot 1] action", "[Shot 1] action [Shot 3] cut"),
            source["prompt"].replace("[Shot 1]", ""),
        ):
            with self.subTest(prompt=prompt):
                self.assertNotEqual(self.check_prompt({**source, "prompt": prompt}).returncode, 0)


if __name__ == "__main__":
    unittest.main()
