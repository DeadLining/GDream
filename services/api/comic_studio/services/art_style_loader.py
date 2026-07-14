"""Art style loader for M3.3.

Loads art style directories from `data_root/art_styles/<style_id>/`:

* `README.md`    — human description (optional)
* `prefix.md`    — positive prompt prefix (required for generation)
* `negative_prompt.md` — negative prompt fragment (optional)
* `images/`      — reference images (optional, names are preserved)

The loader is lazy, side-effect free at import time, and provides a small
registry interface used by the panel/video services to inject style prompts.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from comic_studio.config import get_settings


@dataclass(frozen=True)
class ArtStyle:
    id: str
    name: str
    description: str
    prefix: str
    negative: str
    image_paths: list[Path] = field(default_factory=list)


class ArtStyleLoader:
    """Thread-safe art style loader with mtime-based hot reload.

    Discovers styles from the user ``styles_dir`` (typically ``data_root/art_styles``)
    and falls back to the bundled ``default_styles_dir`` (the repo's ``data/art_styles``).
    User styles override bundled styles with the same id.
    """

    def __init__(
        self,
        art_styles_dir: Path | None = None,
        *,
        default_styles_dir: Path | None = None,
    ) -> None:
        self._art_styles_dir = art_styles_dir
        self._default_styles_dir = default_styles_dir
        self._cache: dict[str, ArtStyle] = {}
        self._mtimes: dict[str, float] = {}
        self._lock = threading.Lock()

    @property
    def styles_dir(self) -> Path:
        if self._art_styles_dir is not None:
            return self._art_styles_dir
        return get_settings().data_root / "art_styles"

    @property
    def default_styles_dir(self) -> Path | None:
        if self._default_styles_dir is not None:
            return self._default_styles_dir
        return None

    def _scan(self) -> dict[str, ArtStyle]:
        found: dict[str, ArtStyle] = {}
        for base in self._style_sources():
            if not base.is_dir():
                continue
            for child in sorted(base.iterdir()):
                if not child.is_dir() or child.name.startswith("."):
                    continue
                style_id = child.name
                readme = child / "README.md"
                prefix_file = child / "prefix.md"
                negative_file = child / "negative_prompt.md"
                images_dir = child / "images"

                if not prefix_file.is_file():
                    continue

                name = readme.is_file() and readme.read_text(encoding="utf-8").splitlines()[0].lstrip("# ").strip() or style_id
                description = readme.is_file() and readme.read_text(encoding="utf-8").strip() or ""
                prefix = prefix_file.read_text(encoding="utf-8").strip()
                negative = negative_file.read_text(encoding="utf-8").strip() if negative_file.is_file() else ""
                image_paths = sorted(p for p in images_dir.iterdir() if p.is_file()) if images_dir.is_dir() else []
                found[style_id] = ArtStyle(
                    id=style_id,
                    name=name,
                    description=description,
                    prefix=prefix,
                    negative=negative,
                    image_paths=image_paths,
                )
        return found

    def _style_sources(self) -> list[Path]:
        """Return directories to scan, with later entries overriding earlier ones."""
        sources = []
        default = self.default_styles_dir
        if default is not None and default.is_dir():
            sources.append(default)
        user = self.styles_dir
        if user.is_dir():
            sources.append(user)
        return sources

    def _max_mtime(self, style_dir: Path) -> float | None:
        # Use the most recent mtime across all sources that contain this style.
        mtimes: list[float] = []
        for base in self._style_sources():
            candidate = base / style_dir.name
            if not candidate.is_dir():
                continue
            for path in (candidate, candidate / "README.md", candidate / "prefix.md", candidate / "negative_prompt.md"):
                if path.exists():
                    try:
                        mtimes.append(path.stat().st_mtime)
                    except OSError:
                        pass
            images_dir = candidate / "images"
            if images_dir.is_dir():
                for path in images_dir.iterdir():
                    if path.is_file():
                        try:
                            mtimes.append(path.stat().st_mtime)
                        except OSError:
                            pass
        return max(mtimes) if mtimes else None

    def _needs_reload(self, style_id: str, style_dir: Path) -> bool:
        current = self._mtimes.get(style_id)
        latest = self._max_mtime(style_dir)
        if latest is None:
            return style_id in self._cache
        return current is None or current != latest

    def list_styles(self) -> list[ArtStyle]:
        """Return all discovered styles, sorted by style id."""
        with self._lock:
            styles = self._scan()
            for style_id, style in styles.items():
                if self._needs_reload(style_id, self.styles_dir / style_id):
                    self._cache[style_id] = style
                    self._mtimes[style_id] = self._max_mtime(self.styles_dir / style_id) or 0.0
            # Remove stale entries.
            for style_id in list(self._cache):
                if style_id not in styles:
                    del self._cache[style_id]
                    self._mtimes.pop(style_id, None)
            return [self._cache[style_id] for style_id in sorted(self._cache)]

    def get(self, style_id: str) -> ArtStyle:
        """Return a single style by id, reloading from disk if changed."""
        if ".." in style_id or "/" in style_id or style_id.startswith("."):
            raise KeyError(style_id)
        with self._lock:
            style_dir = self.styles_dir / style_id
            exists_in_user = style_dir.is_dir()
            exists_in_default = bool(
                self.default_styles_dir and (self.default_styles_dir / style_id).is_dir()
            )
            if not exists_in_user and not exists_in_default:
                raise KeyError(style_id)
            if self._needs_reload(style_id, style_dir):
                styles = self._scan()
                if style_id not in styles:
                    raise KeyError(style_id)
                self._cache[style_id] = styles[style_id]
                self._mtimes[style_id] = self._max_mtime(style_dir) or 0.0
            return self._cache[style_id]

    def get_prefix(self, style_id: str) -> str:
        return self.get(style_id).prefix

    def get_negative(self, style_id: str) -> str:
        return self.get(style_id).negative

    def resolve_negative(self, style_id: str | None, fallback: str = "") -> str:
        """Return the combined negative prompt for a style, falling back to a base."""
        if not style_id:
            return fallback
        try:
            style_negative = self.get_negative(style_id)
        except KeyError:
            return fallback
        if not fallback:
            return style_negative
        if not style_negative:
            return fallback
        return f"{fallback}, {style_negative}"


# --- Module-level singleton ------------------------------------------------

_loader_singleton: ArtStyleLoader | None = None
_loader_lock = threading.Lock()


def _bundled_styles_dir() -> Path:
    """Return the art styles directory bundled with the repository.

    ``art_style_loader.py`` lives under ``services/api/comic_studio/services/``;
    walking up five parents reaches the repository root.
    """
    return (Path(__file__).resolve().parent.parent.parent.parent.parent / "data" / "art_styles")


def get_art_style_loader() -> ArtStyleLoader:
    """Return the process-wide ArtStyleLoader singleton."""
    global _loader_singleton
    if _loader_singleton is None:
        with _loader_lock:
            if _loader_singleton is None:
                _loader_singleton = ArtStyleLoader(
                    default_styles_dir=_bundled_styles_dir(),
                )
    return _loader_singleton


def reset_art_style_loader() -> None:
    """Drop the cached singleton. Used by tests that swap settings/data_root."""
    global _loader_singleton
    with _loader_lock:
        _loader_singleton = None


__all__: Iterable[str] = (
    "ArtStyle",
    "ArtStyleLoader",
    "get_art_style_loader",
    "reset_art_style_loader",
)
