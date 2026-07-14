"""Tests for the M3.3 art style catalog."""

from __future__ import annotations

import pytest

from comic_studio.services.art_style_loader import (
    ArtStyleLoader,
    get_art_style_loader,
    reset_art_style_loader,
)


@pytest.fixture
def styles_dir(tmp_path):
    base = tmp_path / "art_styles"
    for style_id in ("2d_anime", "watercolor"):
        (base / style_id).mkdir(parents=True)
        (base / style_id / "prefix.md").write_text(f"{style_id} prefix", encoding="utf-8")
        (base / style_id / "README.md").write_text(f"# {style_id}\n\ndesc", encoding="utf-8")
        (base / style_id / "negative_prompt.md").write_text(f"not {style_id}", encoding="utf-8")
    # incomplete style missing prefix -> should be skipped
    (base / "broken").mkdir()
    (base / "broken" / "README.md").write_text("# broken", encoding="utf-8")
    return base


def test_loader_lists_styles(styles_dir):
    loader = ArtStyleLoader(styles_dir)
    styles = loader.list_styles()
    assert [s.id for s in styles] == ["2d_anime", "watercolor"]


def test_loader_reads_prefix_and_negative(styles_dir):
    loader = ArtStyleLoader(styles_dir)
    style = loader.get("watercolor")
    assert style.prefix == "watercolor prefix"
    assert style.negative == "not watercolor"
    assert style.name == "watercolor"


def test_loader_skips_incomplete_styles(styles_dir):
    loader = ArtStyleLoader(styles_dir)
    with pytest.raises(KeyError):
        loader.get("broken")


def test_resolve_negative_combines_and_falls_back(styles_dir):
    loader = ArtStyleLoader(styles_dir)
    assert loader.resolve_negative("watercolor", "base") == "base, not watercolor"
    assert loader.resolve_negative(None, "base") == "base"
    assert loader.resolve_negative("missing", "base") == "base"


def test_loader_hot_reloads(styles_dir):
    loader = ArtStyleLoader(styles_dir)
    assert loader.get("watercolor").prefix == "watercolor prefix"
    import time

    time.sleep(0.01)
    (styles_dir / "watercolor" / "prefix.md").write_text("new prefix", encoding="utf-8")
    assert loader.get("watercolor").prefix == "new prefix"


def test_loader_rejects_path_traversal(styles_dir):
    loader = ArtStyleLoader(styles_dir)
    with pytest.raises(KeyError):
        loader.get("../etc")
    with pytest.raises(KeyError):
        loader.get("a/b")


def test_singleton_resets_between_tests(styles_dir):
    reset_art_style_loader()
    loader = get_art_style_loader()
    assert loader.styles_dir == get_art_style_loader().styles_dir
    reset_art_style_loader()
