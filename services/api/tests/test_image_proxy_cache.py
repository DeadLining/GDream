"""M4.4 — Image proxy cache tests."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

from comic_studio import models
from comic_studio.services.image_proxy_cache import ImageProxyCacheService


PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
    b"\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
    b"\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


async def _fake_fetcher(url: str):
    return PNG_BYTES, "image/png"


def _make_service(session, data_root):
    return ImageProxyCacheService(session, Path(data_root), fetcher=_fake_fetcher)


def test_hash_url_is_stable():
    assert ImageProxyCacheService.hash_url("https://example.com/a.png") == (
        ImageProxyCacheService.hash_url("https://example.com/a.png")
    )
    assert (
        ImageProxyCacheService.hash_url("https://example.com/a.png")
        != ImageProxyCacheService.hash_url("https://example.com/b.png")
    )


def test_service_fetches_and_then_serves_from_cache(db_session, tmp_path):
    service = _make_service(db_session, tmp_path)
    url = "https://cdn.example.com/image.png"

    first = asyncio.run(service.get(url))
    second = asyncio.run(service.get(url))

    assert first.from_cache is False
    assert second.from_cache is True
    assert first.local_path == second.local_path
    assert first.media_type == "image/png"
    assert first.byte_size == len(PNG_BYTES)
    assert (tmp_path / first.local_path).read_bytes() == PNG_BYTES

    row = db_session.get(models.ImageProxyCache, first.url_hash)
    assert row is not None
    assert row.url == url


def test_service_refetches_when_expired(db_session, tmp_path):
    service = _make_service(db_session, tmp_path)
    url = "https://cdn.example.com/expired.png"

    first = asyncio.run(service.get(url, ttl_hours=1))
    # Force the cached row to be expired relative to now.
    row = db_session.get(models.ImageProxyCache, first.url_hash)
    assert row is not None
    row.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db_session.commit()

    second = asyncio.run(service.get(url, ttl_hours=1))

    assert second.from_cache is False
    assert (tmp_path / second.local_path).read_bytes() == PNG_BYTES


def test_service_prune_expired_removes_rows_and_files(db_session, tmp_path):
    service = _make_service(db_session, tmp_path)
    url = "https://cdn.example.com/prune.png"

    result = asyncio.run(service.get(url, ttl_hours=0))
    # ttl=0 means already expired, so prune should drop it.
    file_path = tmp_path / result.local_path
    assert file_path.is_file()

    pruned = service.prune_expired()

    assert pruned >= 1
    assert db_session.get(models.ImageProxyCache, result.url_hash) is None
    assert not file_path.exists()


def test_image_proxy_route_serves_cached_bytes(client, monkeypatch):
    async def fake_fetcher(self, url):  # noqa: ANN001 - matches staticmethod shape
        return PNG_BYTES, "image/png"

    monkeypatch.setattr(
        ImageProxyCacheService, "_default_fetcher", fake_fetcher, raising=True
    )

    response = client.get(
        "/api/image-proxy", params={"url": "https://cdn.example.com/route.png"}
    )
    assert response.status_code == 200
    assert response.content == PNG_BYTES
    assert response.headers["content-type"].startswith("image/png")

    # Second hit should come from cache and still succeed.
    again = client.get(
        "/api/image-proxy", params={"url": "https://cdn.example.com/route.png"}
    )
    assert again.status_code == 200
    assert again.content == PNG_BYTES


def test_image_proxy_route_rejects_non_http_url(client):
    response = client.get(
        "/api/image-proxy", params={"url": "file:///etc/passwd"}
    )
    assert response.status_code == 400


def test_image_proxy_route_reports_fetch_failure_as_502(client, monkeypatch):
    async def failing_fetcher(self, url):  # noqa: ANN001
        raise RuntimeError("upstream down")

    monkeypatch.setattr(
        ImageProxyCacheService, "_default_fetcher", failing_fetcher, raising=True
    )

    response = client.get(
        "/api/image-proxy", params={"url": "https://cdn.example.com/broken.png"}
    )
    assert response.status_code == 502
