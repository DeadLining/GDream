#!/usr/bin/env python3
"""Deterministic checks for H3 Layer 1 and Layer 2 artifacts.

This validates structure and timing only. It does not judge visual quality or
replace creative review.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

TIME_RE = re.compile(r"^(\d{2}):(\d{2})\.(\d{3})-(\d{2}):(\d{2})\.(\d{3})$")
DURATION_RE = re.compile(r"^([0-9]+(?:\.[0-9]+)?) seconds$")
MODES = {"T2VA", "I2VA", "FL2VA", "L2VA", "REF2VA"}
FORMAT = json.loads((Path(__file__).resolve().parents[1] / "references" / "output-format.json").read_text(encoding="utf-8"))
REQUIRED_ACTION_FIELDS = (
    "time",
    "start_state",
    "primary_action",
    "contact_or_path",
    "visible_result",
    "exit_state",
    "camera_visibility",
    "sound",
)


def fail(message: str) -> None:
    raise ValueError(message)


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"{path}: cannot read JSON: {exc}")
    if not isinstance(value, dict):
        fail(f"{path}: top-level value must be an object")
    return value


def parse_time(value: str) -> float:
    match = TIME_RE.fullmatch(value)
    if not match:
        fail(f"invalid interval {value!r}; expected MM:SS.mmm-MM:SS.mmm")
    m1, s1, ms1, m2, s2, ms2 = map(int, match.groups())
    if s1 >= 60 or s2 >= 60:
        fail(f"invalid second in interval {value!r}")
    start = m1 * 60 + s1 + ms1 / 1000
    end = m2 * 60 + s2 + ms2 / 1000
    if end <= start:
        fail(f"interval must have positive duration: {value!r}")
    return start, end


def parse_duration(value: object) -> float:
    if not isinstance(value, str):
        fail("duration must be a string such as '9 seconds'")
    match = DURATION_RE.fullmatch(value)
    if not match:
        fail(f"invalid duration {value!r}; expected '<number> seconds'")
    duration = float(match.group(1))
    if duration <= 0:
        fail("duration must be positive")
    return duration


def require_text(obj: dict, field: str, path: str) -> None:
    if not isinstance(obj.get(field), str) or not obj[field].strip():
        fail(f"{path}.{field} must be a non-empty string")


def validate_timeline(path: Path) -> list[str]:
    data = load_json(path)
    for field in ("creative_intent", "world_and_spatial_anchors"):
        require_text(data, field, str(path))
    duration = parse_duration(data.get("duration"))
    if data.get("mode") not in MODES:
        fail(f"{path}.mode must be one of {sorted(MODES)}")
    actions = data.get("action_timeline")
    if not isinstance(actions, list) or not actions:
        fail(f"{path}.action_timeline must be a non-empty array")
    if not isinstance(data.get("continuity_contract"), list) or not data["continuity_contract"]:
        fail(f"{path}.continuity_contract must be a non-empty array")
    if not isinstance(data.get("warnings"), list):
        fail(f"{path}.warnings must be an array")

    previous_end = 0.0
    intervals: list[tuple[float, float]] = []
    for index, action in enumerate(actions):
        if not isinstance(action, dict):
            fail(f"{path}.action_timeline[{index}] must be an object")
        for field in REQUIRED_ACTION_FIELDS:
            require_text(action, field, f"{path}.action_timeline[{index}]")
        start, end = parse_time(action["time"])
        if abs(start - previous_end) > 0.0005:
            relation = "gap" if start > previous_end else "overlap"
            fail(
                f"{path}.action_timeline[{index}] has {relation}: "
                f"previous end={previous_end:.3f}, current start={start:.3f}"
            )
        intervals.append((start, end))
        previous_end = end
    if abs(intervals[0][0]) > 0.0005:
        fail(f"{path}.action_timeline must start at 00:00.000")
    if abs(previous_end - duration) > 0.0005:
        fail(
            f"{path}.action_timeline ends at {previous_end:.3f}s, "
            f"but duration is {duration:.3f}s"
        )
    return [f"timeline OK: {path} ({duration:g}s, {len(actions)} intervals)"]


def validate_prompt(path: Path, mode: str | None = None, duration: float | None = None) -> list[str]:
    data = load_json(path)
    require_text(data, "prompt", str(path))
    artifact_mode = data.get("mode")
    if artifact_mode not in MODES:
        fail(f"{path}.mode must be one of {sorted(MODES)}")
    if mode is not None and mode != artifact_mode:
        fail(f"{path}.mode={artifact_mode} conflicts with requested mode={mode}")
    artifact_duration = parse_duration(data.get("duration"))
    if duration is not None and abs(artifact_duration - duration) > 0.0005:
        fail(f"{path}.duration conflicts with timeline duration")
    mode = artifact_mode
    duration = artifact_duration
    prompt = data["prompt"]
    fields = FORMAT["referenceFields" if mode == "REF2VA" else "baseFields"]
    all_fields = list(dict.fromkeys(FORMAT["baseFields"] + FORMAT["referenceFields"]))
    prose = re.sub(r"<d\s*>.*?</d\s*>", lambda m: re.sub(r"[^\r\n]", " ", m.group()), prompt, flags=re.I | re.S)
    if re.search(r"^\s*```", prose, re.M):
        fail(f"{path}.prompt must not contain Markdown fences")
    if re.search(r"^\s*\[(?:REFERENCE_ALIGNMENT|SUBJECTS|WORLD_CONTINUITY|OBJECT_CONTINUITY|ACTION_ENGINE|DIALOGUE|CAMERA_LOGIC|STATE_TRANSITION|AUDIO_LOGIC|RESTRICTIONS)\]", prose, re.M):
        fail(f"{path}.prompt must merge legacy ledgers into its canonical fields and shot body")
    marks = list(re.finditer(r"^[ \t]*(" + "|".join(all_fields) + r"):", prose, re.M))
    if [mark.group(1) for mark in marks] != fields:
        fail(f"{path}.prompt requires each field once in order: {', '.join(fields)}")
    for index, mark in enumerate(marks):
        end = marks[index + 1].start() if index + 1 < len(marks) else len(prompt)
        if not prompt[mark.end():end].strip():
            fail(f"{path}.prompt has empty field {mark.group(1)}")
    preamble = prose[:marks[0].start()].strip()
    if mode in {"T2VA", "REF2VA"} and preamble:
        fail(f"{path}.prompt has unexpected text before its first field")
    if preamble and mode not in {"T2VA", "REF2VA"} and not re.fullmatch(
        r"(?:For the target video, at 0\.00 seconds into the target video, <Picture 1> \(from \[Shot 1\]\) is fully referenced\.|How the reference pictures align with the target video[^\r\n]*)",
        preamble,
    ):
        fail(f"{path}.prompt allows only the keyframe-alignment instruction before its fields")
    timeline_field = FORMAT["referenceTimelineField" if mode == "REF2VA" else "baseTimelineField"]
    timeline_index = fields.index(timeline_field)
    timeline = prose[marks[timeline_index].end():marks[timeline_index + 1].start()]
    shots = re.findall(r"\[Shot\s+(\d+)\]", timeline, re.I)
    if not timeline.lstrip().startswith("[Shot 1]") or [int(n) for n in shots] != list(range(1, len(shots) + 1)):
        fail(f"{path}.prompt timeline must start with [Shot 1] and use consecutive shot labels")
    if mode == "FL2VA":
        if "Picture 1" not in prompt or "Picture 2" not in prompt:
            fail(f"{path}.prompt FL2VA alignment must mention Picture 1 and Picture 2")
        if "0.00-second" not in prompt:
            fail(f"{path}.prompt FL2VA alignment must mention 0.00-second")
        if duration is not None and f"{duration:.2f}-second" not in prompt:
            fail(f"{path}.prompt FL2VA alignment must mention {duration:.2f}-second")
    return [f"prompt OK: {path}"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeline", type=Path)
    parser.add_argument("--prompt", type=Path)
    parser.add_argument("--mode")
    args = parser.parse_args()
    if not args.timeline and not args.prompt:
        parser.error("provide --timeline and/or --prompt")
    try:
        results: list[str] = []
        duration = None
        if args.timeline:
            results.extend(validate_timeline(args.timeline))
            duration = parse_duration(load_json(args.timeline)["duration"])
        if args.prompt:
            results.extend(validate_prompt(args.prompt, args.mode, duration))
        print("\n".join(results))
        return 0
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
