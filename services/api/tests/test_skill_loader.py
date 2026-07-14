"""Tests for M2.1 SkillLoader."""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from comic_studio.services.skill_loader import (
    DEFAULTS,
    SKILL_NAMES,
    SkillLoader,
    UnknownSkillError,
)


# --- Defaults / fallback --------------------------------------------------


def test_get_returns_default_when_file_missing(tmp_path: Path):
    loader = SkillLoader(skills_dir=tmp_path / "skills")
    snapshot = loader.get_snapshot("panel_prompt")
    assert snapshot.source == "default"
    assert snapshot.body == DEFAULTS["panel_prompt"]
    assert snapshot.mtime is None


def test_get_string_helper_returns_default_body(tmp_path: Path):
    loader = SkillLoader(skills_dir=tmp_path / "skills")
    assert loader.get("speech_prompt") == DEFAULTS["speech_prompt"]


def test_unknown_skill_name_rejected(tmp_path: Path):
    loader = SkillLoader(skills_dir=tmp_path)
    with pytest.raises(UnknownSkillError):
        loader.get("definitely_not_a_skill")


def test_all_defaults_cover_known_names():
    assert set(DEFAULTS.keys()) == set(SKILL_NAMES)


# --- Disk load + hot reload ----------------------------------------------


def test_get_reads_from_disk_when_present(tmp_path: Path):
    skills = tmp_path / "skills"
    skills.mkdir()
    (skills / "panel_prompt.md").write_text("hello {visual_style}", encoding="utf-8")
    loader = SkillLoader(skills_dir=skills)
    snapshot = loader.get_snapshot("panel_prompt")
    assert snapshot.source == "disk"
    assert snapshot.body == "hello {visual_style}"
    assert snapshot.mtime is not None


def test_hot_reload_picks_up_edits(tmp_path: Path):
    skills = tmp_path / "skills"
    skills.mkdir()
    path = skills / "video_prompt.md"
    path.write_text("v1", encoding="utf-8")
    loader = SkillLoader(skills_dir=skills)
    assert loader.get("video_prompt") == "v1"
    # Bump mtime by writing new content and forcing a newer mtime.
    path.write_text("v2", encoding="utf-8")
    new_mtime = time.time() + 5
    os.utime(path, (new_mtime, new_mtime))
    assert loader.get("video_prompt") == "v2"
    snap = loader.get_snapshot("video_prompt")
    assert snap.source == "disk"


def test_missing_file_then_created_is_picked_up(tmp_path: Path):
    skills = tmp_path / "skills"
    skills.mkdir()
    loader = SkillLoader(skills_dir=skills)
    # First read falls back to default.
    assert loader.get_snapshot("speech_prompt").source == "default"
    # Create the file → next read must come from disk.
    (skills / "speech_prompt.md").write_text("on-disk", encoding="utf-8")
    assert loader.get("speech_prompt") == "on-disk"
    assert loader.get_snapshot("speech_prompt").source == "disk"


# --- render() ------------------------------------------------------------


def test_render_substitutes_known_placeholders(tmp_path: Path):
    loader = SkillLoader(skills_dir=tmp_path / "skills")
    out = loader.render("panel_prompt", visual_style="ink wash", scene_location="alley")
    assert "ink wash" in out
    assert "alley" in out
    # The default panel template references these placeholders.
    assert "Series visual style: ink wash" in out


def test_render_leaves_unknown_placeholders_untouched(tmp_path: Path):
    skills = tmp_path / "skills"
    skills.mkdir()
    (skills / "panel_prompt.md").write_text(
        "style={visual_style} unknown={not_a_variable}", encoding="utf-8"
    )
    loader = SkillLoader(skills_dir=skills)
    rendered = loader.render("panel_prompt", visual_style="gothic")
    assert rendered == "style=gothic unknown={not_a_variable}"


# --- Path traversal protection ------------------------------------------


def test_path_traversal_name_rejected(tmp_path: Path):
    loader = SkillLoader(skills_dir=tmp_path)
    # Even if the file existed outside, the name itself is unknown → rejected.
    with pytest.raises(UnknownSkillError):
        loader.get("../../etc/passwd")


def test_resolve_path_stays_inside_skills_dir(tmp_path: Path):
    skills = tmp_path / "skills"
    skills.mkdir()
    loader = SkillLoader(skills_dir=skills)
    resolved = loader._resolve_path("panel_prompt")
    assert resolved.parent.resolve() == skills.resolve()


# --- write() -------------------------------------------------------------


def test_write_persists_and_invalidates_cache(tmp_path: Path):
    skills = tmp_path / "skills"
    skills.mkdir()
    loader = SkillLoader(skills_dir=skills)
    snapshot = loader.write("panel_prompt", "brand new body")
    assert snapshot.source == "disk"
    assert snapshot.body == "brand new body"
    assert (skills / "panel_prompt.md").read_text(encoding="utf-8") == "brand new body"
    # New loader instance reads from disk.
    fresh = SkillLoader(skills_dir=skills)
    assert fresh.get("panel_prompt") == "brand new body"


def test_write_creates_skills_dir_if_missing(tmp_path: Path):
    skills = tmp_path / "nested" / "skills"
    loader = SkillLoader(skills_dir=skills)
    loader.write("speech_prompt", "hello")
    assert (skills / "speech_prompt.md").is_file()


def test_write_rejects_unknown_name(tmp_path: Path):
    loader = SkillLoader(skills_dir=tmp_path)
    with pytest.raises(UnknownSkillError):
        loader.write("bogus", "x")


# --- list_skills() --------------------------------------------------------


def test_list_skills_returns_one_per_known_name(tmp_path: Path):
    skills = tmp_path / "skills"
    skills.mkdir()
    (skills / "panel_prompt.md").write_text("on disk", encoding="utf-8")
    loader = SkillLoader(skills_dir=skills)
    snapshots = loader.list_skills()
    assert [s.name for s in snapshots] == sorted(SKILL_NAMES)
    by_name = {s.name: s for s in snapshots}
    assert by_name["panel_prompt"].source == "disk"
    # Others fall back to defaults.
    assert by_name["speech_prompt"].source == "default"
