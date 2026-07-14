"""M4.4 — On-disk cache for remote images.

Remote assets (object storage, CDN, generated preview URLs) are fetched once,
stored under ``data_root/image_proxy/<hash>/<hash>`` and served from disk on
subsequent requests. Each row carries an optional ``expires_at`` so stale
copies are pruned automatically.

The fetch layer is injectable so tests can avoid real network I/O.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from comic_studio import models


@dataclass(frozen=True)
class ImageProxyResult:
    """Outcome of a cache lookup/fetch."""

    url_hash: str
    local_path: str
    media_type: str
    byte_size: int
    from_cache: bool


FetchResult = tuple[bytes, str]


class ImageProxyCacheService:
    """Disk-backed cache for remote image URLs."""

    DEFAULT_TTL_HOURS = 24 * 7

    def __init__(
        self,
        session: Session,
        data_root: Path,
        *,
        fetcher=None,
        default_ttl_hours: int = DEFAULT_TTL_HOURS,
    ):
        self.session = session
        self.data_root = Path(data_root)
        self.fetcher = fetcher or self._default_fetcher
        self.default_ttl_hours = default_ttl_hours

    @staticmethod
    def hash_url(url: str) -> str:
        return hashlib.sha256(url.encode("utf-8")).hexdigest()

    @staticmethod
    async def _default_fetcher(url: str) -> FetchResult:
        import httpx

        async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
            response = await client.get(url)
            response.raise_for_status()
            media_type = response.headers.get("content-type", "application/octet-stream")
            return response.content, media_type

    def _cache_dir(self, url_hash: str) -> Path:
        directory = self.data_root / "image_proxy" / url_hash[:2]
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    @staticmethod
    def _as_aware(value: datetime) -> datetime:
        # SQLite stores tz-aware datetimes as naive values on read-back, so
        # normalize before comparing to ``datetime.now(UTC)``.
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value

    def _is_fresh(self, row: models.ImageProxyCache) -> bool:
        if row.expires_at is not None:
            if self._as_aware(row.expires_at) <= datetime.now(UTC):
                return False
        return (self.data_root / row.local_path).is_file()

    async def get(self, url: str, *, ttl_hours: int | None = None) -> ImageProxyResult:
        """Return the cached file for ``url``, fetching it if absent/stale."""
        url_hash = self.hash_url(url)
        row = self.session.get(models.ImageProxyCache, url_hash)
        if row is not None and self._is_fresh(row):
            return ImageProxyResult(
                url_hash=url_hash,
                local_path=row.local_path,
                media_type=row.media_type,
                byte_size=row.byte_size,
                from_cache=True,
            )

        content, media_type = await self.fetcher(url)
        directory = self._cache_dir(url_hash)
        file_path = directory / url_hash
        file_path.write_bytes(content)

        ttl = self.default_ttl_hours if ttl_hours is None else ttl_hours
        # ttl <= 0 means "already expired" (cache-bust / immediate stale).
        expires_at = (
            datetime.now(UTC) + timedelta(hours=ttl) if ttl and ttl > 0
            else datetime.now(UTC)
        )
        relative_path = str(file_path.relative_to(self.data_root))

        if row is None:
            row = models.ImageProxyCache(
                url_hash=url_hash,
                url=url,
                local_path=relative_path,
                media_type=media_type,
                byte_size=len(content),
                expires_at=expires_at,
            )
            self.session.add(row)
        else:
            row.url = url
            row.local_path = relative_path
            row.media_type = media_type
            row.byte_size = len(content)
            row.expires_at = expires_at
        self.session.commit()
        self.session.refresh(row)

        return ImageProxyResult(
            url_hash=url_hash,
            local_path=relative_path,
            media_type=media_type,
            byte_size=len(content),
            from_cache=False,
        )

    def prune_expired(self) -> int:
        """Delete expired cache rows and their files. Returns the count pruned."""
        now = datetime.now(UTC)
        rows = list(
            self.session.scalars(
                select(models.ImageProxyCache).where(
                    models.ImageProxyCache.expires_at.is_not(None),
                    models.ImageProxyCache.expires_at <= now,
                )
            )
        )
        rows = [row for row in rows if self._as_aware(row.expires_at) <= now]
        for row in rows:
            try:
                (self.data_root / row.local_path).unlink(missing_ok=True)
            except OSError:
                pass
            self.session.delete(row)
        self.session.commit()
        return len(rows)
