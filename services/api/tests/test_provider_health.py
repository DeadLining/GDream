import asyncio
import threading
from types import SimpleNamespace
from urllib.parse import urlparse

import pytest

from comic_studio.routes.providers import test_provider as run_provider_health_test
from comic_studio.schemas import ProviderChannelTestRead


KINDS = ("llm", "image", "tts", "video")


def _enable_all_channels(client):
    store = client.app.state.provider_channel_store
    current = store.snapshot
    updates = {}
    for kind in KINDS:
        channel = getattr(current, kind)
        updates[kind] = channel.model_copy(
            update={
                "enabled": True,
                "api_key": channel.api_key_value or f"sk-secret-{kind}",
            }
        )
    store.save(current.model_copy(update=updates))
    return store.snapshot


def _result(kind, channel, *, status="ok", error=None):
    return ProviderChannelTestRead(
        status=status,
        model=channel.model,
        host=f"checked-{kind}.example",
        elapsed_ms=12,
        check_scope="audio" if kind == "tts" else "model",
        error=error,
    )


def test_provider_health_tests_enabled_channels_concurrently(client, monkeypatch):
    _enable_all_channels(client)
    active = 0
    peak = 0
    lock = asyncio.Lock()
    all_started = asyncio.Event()

    class FakeService:
        def __init__(self, **_kwargs):
            pass

        async def test(self, kind, channel):
            nonlocal active, peak
            async with lock:
                active += 1
                peak = max(peak, active)
                if active == len(KINDS):
                    all_started.set()
            await asyncio.wait_for(all_started.wait(), timeout=0.5)
            async with lock:
                active -= 1
            return _result(kind, channel)

    monkeypatch.setattr(
        "comic_studio.model_runtime.service.ProviderChannelTestingService",
        FakeService,
    )

    response = client.get("/api/providers/health")

    assert response.status_code == 200
    assert peak > 1
    assert set(response.json()) == set(KINDS)
    assert "sk-secret" not in str(response.json()).lower()


def test_provider_health_skips_disabled_channels_and_redacts_hosts(client, monkeypatch):
    store = client.app.state.provider_channel_store
    current = store.snapshot
    store.save(
        current.model_copy(
            update={
                kind: getattr(current, kind).model_copy(
                    update={
                        "enabled": False,
                        "base_url": f"https://user:password@{kind}.example:8443/private?token=secret",
                    }
                )
                for kind in KINDS
            }
        )
    )

    class FailIfCreated:
        def __init__(self, **_kwargs):
            raise AssertionError("disabled channels must not create a testing service")

    monkeypatch.setattr(
        "comic_studio.model_runtime.service.ProviderChannelTestingService",
        FailIfCreated,
    )

    response = client.get("/api/providers/health")

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == set(KINDS)
    for kind in KINDS:
        assert payload[kind] == {
            "status": "disabled",
            "model": getattr(store.snapshot, kind).model,
            "host": f"{kind}.example",
            "elapsed_ms": 0,
            "check_scope": "audio" if kind == "tts" else "model",
            "error": None,
        }
    serialized = str(payload).lower()
    assert "password" not in serialized
    assert "token" not in serialized


def test_provider_health_returns_partial_failures_without_aborting(client, monkeypatch):
    _enable_all_channels(client)

    class FakeService:
        def __init__(self, **_kwargs):
            pass

        async def test(self, kind, channel):
            if kind == "image":
                return _result(
                    kind,
                    channel,
                    status="failed",
                    error="Provider returned HTTP 503",
                )
            return _result(kind, channel)

    monkeypatch.setattr(
        "comic_studio.model_runtime.service.ProviderChannelTestingService",
        FakeService,
    )

    response = client.get("/api/providers/health")

    assert response.status_code == 200
    assert response.json()["image"]["status"] == "failed"
    assert response.json()["image"]["error"] == "Provider returned HTTP 503"
    assert response.json()["llm"]["status"] == "ok"
    assert response.json()["tts"]["status"] == "ok"
    assert response.json()["video"]["status"] == "ok"


def test_provider_health_sanitizes_unexpected_channel_exception(client, monkeypatch):
    snapshot = _enable_all_channels(client)

    class FakeService:
        def __init__(self, **_kwargs):
            pass

        async def test(self, kind, channel):
            if kind == "video":
                raise RuntimeError("secret-token raw provider body")
            return _result(kind, channel)

    monkeypatch.setattr(
        "comic_studio.model_runtime.service.ProviderChannelTestingService",
        FakeService,
    )

    response = client.get("/api/providers/health")

    assert response.status_code == 200
    assert response.json()["video"] == {
        "status": "failed",
        "model": snapshot.video.model,
        "host": "api.minimaxi.com",
        "elapsed_ms": 0,
        "check_scope": "model",
        "error": "Provider test failed (RuntimeError)",
    }
    assert "secret-token" not in str(response.json())


def test_provider_health_uses_media_timeouts_and_bridge_callback(client, monkeypatch):
    snapshot = _enable_all_channels(client)
    store = client.app.state.provider_channel_store
    store.save(
        snapshot.model_copy(
            update={
                "tts": snapshot.tts.model_copy(update={"ssh_host": "render-alias"}),
                "video": snapshot.video.model_copy(update={"ssh_host": "render-alias"}),
            }
        )
    )
    calls = []
    client.app.state.mock_ssh_manager.owns_running_alias = (
        lambda alias: alias == "render-alias"
    )

    class FakeService:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            calls.append(kwargs)

        async def test(self, kind, channel):
            if kind in {"tts", "video"}:
                assert self.kwargs["prefer_ssh_for_host"]("render-alias") is True
            return _result(kind, channel)

    monkeypatch.setattr(
        "comic_studio.model_runtime.service.ProviderChannelTestingService",
        FakeService,
    )

    response = client.get("/api/providers/health")

    assert response.status_code == 200
    assert [call["total_timeout_seconds"] for call in calls].count(60) == 2
    assert [call["total_timeout_seconds"] for call in calls].count(8) == 2


@pytest.mark.anyio
async def test_provider_health_keeps_event_loop_responsive_during_bridge_lookup(
    client,
    monkeypatch,
):
    snapshot = _enable_all_channels(client)
    snapshot = snapshot.model_copy(
        update={
            "tts": snapshot.tts.model_copy(update={"ssh_host": "render-alias"})
        }
    )
    order = []
    release = threading.Event()

    class BlockingManager:
        def owns_running_alias(self, alias):
            assert alias == "render-alias"
            order.append("manager-start")
            release.wait(timeout=1)
            order.append("manager-end")
            return True

    class FakeService:
        def __init__(self, **kwargs):
            self.prefer_ssh_for_host = kwargs["prefer_ssh_for_host"]

        async def test(self, kind, channel):
            assert self.prefer_ssh_for_host(channel.ssh_host) is True
            return _result(kind, channel)

    monkeypatch.setattr(
        "comic_studio.routes.providers.ProviderChannelTestingService",
        FakeService,
    )
    request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(mock_ssh_manager=BlockingManager())
        )
    )

    async def heartbeat_and_release():
        await asyncio.sleep(0.01)
        order.append("heartbeat")
        release.set()

    result, _ = await asyncio.gather(
        run_provider_health_test(request, "tts", snapshot),
        heartbeat_and_release(),
    )

    assert result.status == "ok"
    assert order == ["manager-start", "heartbeat", "manager-end"]


def test_provider_health_contains_constructor_failure_per_channel(client, monkeypatch):
    snapshot = _enable_all_channels(client)

    class FakeService:
        def __init__(self, **kwargs):
            if kwargs["total_timeout_seconds"] == 60:
                raise RuntimeError("secret-constructor-detail")

        async def test(self, kind, channel):
            return _result(kind, channel)

    monkeypatch.setattr(
        "comic_studio.model_runtime.service.ProviderChannelTestingService",
        FakeService,
    )

    response = client.get("/api/providers/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["tts"] == {
        "status": "failed",
        "model": snapshot.tts.model,
        "host": urlparse(snapshot.tts.base_url).hostname or "local",
        "elapsed_ms": 0,
        "check_scope": "audio",
        "error": "Provider test failed (RuntimeError)",
    }
    assert payload["llm"]["status"] == "ok"
    assert payload["image"]["status"] == "ok"
    assert payload["video"]["status"] == "ok"
    assert "secret-constructor-detail" not in str(payload)


def test_provider_health_uses_one_snapshot_for_all_channels(client, monkeypatch):
    initial = _enable_all_channels(client)
    store = client.app.state.provider_channel_store
    seen_models = {}
    saved = False

    class FakeService:
        def __init__(self, **kwargs):
            self.stored_channel = kwargs["stored_channel"]

        async def test(self, kind, channel):
            nonlocal saved
            if not saved:
                saved = True
                latest = store.snapshot
                store.save(
                    latest.model_copy(
                        update={
                            channel_kind: getattr(latest, channel_kind).model_copy(
                                update={"model": f"new-{channel_kind}"}
                            )
                            for channel_kind in KINDS
                        }
                    )
                )
                await asyncio.sleep(0)
            seen_models[kind] = (
                channel.model,
                self.stored_channel(kind).model,
            )
            return _result(kind, channel)

    monkeypatch.setattr(
        "comic_studio.model_runtime.service.ProviderChannelTestingService",
        FakeService,
    )

    response = client.get("/api/providers/health")

    assert response.status_code == 200
    assert seen_models == {
        kind: (getattr(initial, kind).model, getattr(initial, kind).model)
        for kind in KINDS
    }


def test_service_health_endpoint_is_unchanged(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
