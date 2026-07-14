"""Skill loader for M2.1.

Loads Markdown prompt templates from `data_root/skills/*.md` with mtime-based
hot reload, sensible defaults when files are missing, and path-traversal
protection. The loader is intentionally side-effect free at import time — it
reads lazily on first access so missing skill files never break startup.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from comic_studio.config import get_settings


# --- Defaults -------------------------------------------------------------
# These mirror the templates shipped under `data/skills/`. They are used when
# the corresponding file is absent on disk, so the system stays runnable even
# before anyone creates the skill directory.

_DEFAULT_PANEL_PROMPT = (
    "Create one polished vertical comic panel with no captions or text.\n"
    "Series visual style: {visual_style}\n"
    "Scene: {scene_location}; {scene_summary}\n"
    "Shot composition: {shot_composition}\n"
    "Shot prompt: {shot_image_prompt}\n"
    "Characters:\n{character_rules}\n"
    "Negative constraints: {negative_constraints}"
)

_DEFAULT_SPEECH_PROMPT = (
    "Speak the following line in character as {character_name}.\n"
    "Emotion: {emotion}\n"
    "Locale: {locale}\n\n"
    "Line:\n{text}"
)

_DEFAULT_VIDEO_PROMPT = (
    "Animate a short vertical comic clip, no captions or text overlays.\n"
    "Scene: {scene_location}; {scene_summary}\n"
    "Shot composition: {shot_composition}\n"
    "Motion direction: {shot_video_prompt}\n"
    "Target duration: {duration_seconds}s"
)

_DEFAULT_SCRIPT_ADAPTATION_PROMPT = (
    "You are a screenwriter adapting a Chinese web novel chapter into a short vertical\n"
    "comic episode. Visual style: {visual_style}.\n\n"
    "Source chapter events (use only these, do not invent new plot points):\n"
    "{chapter_events}\n\n"
    "Produce exactly {target_beats} beats. For each beat give: scene location,\n"
    "short narration, and any spoken dialogue. Avoid text that must be rendered as\n"
    "on-screen captions — dialogue is spoken aloud, not drawn."
)

_DEFAULT_GRID_PANEL_PROMPT = (
    "Create a 2x2 vertical comic grid with no captions, no text, and no speech bubbles.\n"
    "All four panels must share the same consistent visual style, lighting, and\n"
    "character designs so they read as sequential shots from the same scene.\n\n"
    "Series visual style: {visual_style}\n"
    "Scene: {scene_location}; {scene_summary}\n\n"
    "Characters (keep consistent across all panels):\n"
    "{character_rules}\n\n"
    "Panels (read left-to-right, top-to-bottom):\n"
    "{panel_descriptions}\n\n"
    "Negative constraints: {negative_constraints}"
)

DEFAULTS: dict[str, str] = {
    "panel_prompt": _DEFAULT_PANEL_PROMPT,
    "grid_panel_prompt": _DEFAULT_GRID_PANEL_PROMPT,
    "speech_prompt": _DEFAULT_SPEECH_PROMPT,
    "video_prompt": _DEFAULT_VIDEO_PROMPT,
    "script_adaptation_prompt": _DEFAULT_SCRIPT_ADAPTATION_PROMPT,
}

# Names that clients are allowed to ask for. Anything else is rejected to
# prevent path-traversal via crafted names like `../../etc/passwd`.
SKILL_NAMES: frozenset[str] = frozenset(DEFAULTS.keys())


class UnknownSkillError(KeyError):
    """Raised when a caller asks for a skill name that is not registered."""


@dataclass(frozen=True)
class SkillSnapshot:
    name: str
    body: str
    source: str  # "disk" or "default"
    mtime: float | None  # file mtime when read from disk; None for default


class SkillLoader:
    """Thread-safe loader with mtime-based hot reload."""

    def __init__(self, skills_dir: Path | None = None) -> None:
        # Resolve directory lazily through settings unless explicitly provided
        # (tests pass a temp dir).
        self._skills_dir = skills_dir
        self._cache: dict[str, SkillSnapshot] = {}
        self._lock = threading.Lock()

    @property
    def skills_dir(self) -> Path:
        if self._skills_dir is not None:
            return self._skills_dir
        return get_settings().data_root / "skills"

    def _resolve_path(self, name: str) -> Path:
        """Resolve a skill name to an absolute file path inside skills_dir.

        Refuses names that escape the skills directory.
        """
        if name not in SKILL_NAMES:
            raise UnknownSkillError(name)
        base = self.skills_dir.resolve()
        candidate = (base / f"{name}.md").resolve()
        # Ensure the resolved path is still inside the base dir.
        try:
            candidate.relative_to(base)
        except ValueError as exc:
            raise UnknownSkillError(name) from exc
        return candidate

    def _read_from_disk(self, name: str) -> SkillSnapshot | None:
        path = self._resolve_path(name)
        if not path.is_file():
            return None
        body = path.read_text(encoding="utf-8")
        return SkillSnapshot(
            name=name,
            body=body,
            source="disk",
            mtime=path.stat().st_mtime,
        )

    def get(self, name: str) -> str:
        """Return the current body of the skill, hot-reloading if the file changed."""
        return self.get_snapshot(name).body

    def get_snapshot(self, name: str) -> SkillSnapshot:
        snapshot: SkillSnapshot | None
        with self._lock:
            snapshot = self._cache.get(name)
            on_disk = self._read_from_disk(name)
            if on_disk is not None:
                if snapshot is None or snapshot.mtime != on_disk.mtime:
                    self._cache[name] = on_disk
                    return on_disk
                return snapshot
            # File missing → fall back to default (do not cache so a future
            # write to disk is picked up on the next call).
            return SkillSnapshot(
                name=name,
                body=DEFAULTS[name],
                source="default",
                mtime=None,
            )

    def list_skills(self) -> list[SkillSnapshot]:
        """Return all known skills (disk if present, else default), sorted by name."""
        return [self.get_snapshot(name) for name in sorted(SKILL_NAMES)]

    def render(self, name: str, **variables: object) -> str:
        """Return the skill body with `str.format`-style variables substituted.

        Unknown placeholders are left as-is (Template-safe via `format_map`).
        """
        body = self.get(name)
        return body.format_map(_SafeDict(variables))

    def write(self, name: str, body: str) -> SkillSnapshot:
        """Persist a skill body to disk and refresh the cache.

        The skills directory is created if missing. The body is validated to be
        text; callers are responsible for content.
        """
        if name not in SKILL_NAMES:
            raise UnknownSkillError(name)
        path = self._resolve_path(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
        snapshot = SkillSnapshot(
            name=name,
            body=body,
            source="disk",
            mtime=path.stat().st_mtime,
        )
        with self._lock:
            self._cache[name] = snapshot
        return snapshot


class _SafeDict(dict):
    """dict subclass that leaves missing format keys untouched instead of raising."""

    def __missing__(self, key: str) -> str:  # type: ignore[override]
        return "{" + key + "}"


# --- Module-level singleton (process-wide cache) -------------------------

_loader_singleton: SkillLoader | None = None
_loader_lock = threading.Lock()


def get_skill_loader() -> SkillLoader:
    """Return the process-wide SkillLoader singleton."""
    global _loader_singleton
    if _loader_singleton is None:
        with _loader_lock:
            if _loader_singleton is None:
                _loader_singleton = SkillLoader()
    return _loader_singleton


def reset_skill_loader() -> None:
    """Drop the cached singleton. Used by tests that swap settings/data_root."""
    global _loader_singleton
    with _loader_lock:
        _loader_singleton = None


__all__: Iterable[str] = (
    "DEFAULTS",
    "SKILL_NAMES",
    "SkillLoader",
    "SkillSnapshot",
    "UnknownSkillError",
    "get_skill_loader",
    "reset_skill_loader",
)
