import asyncio
import base64
import json
import subprocess
import threading
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from comic_studio import models
from comic_studio.provider_channels import ProviderChannel
from comic_studio.schemas import ProviderChannelUpdate
from comic_studio.services.provider_channel_testing import (
    ProviderChannelTestingService,
)


class FakeResponse:
    def __init__(
        self,
        status_code=200,
        *,
        content=b"",
        headers=None,
        payload=None,
    ):
        self.status_code = status_code
        self.content = content
        self.headers = headers or {}
        self._payload = payload or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            request = httpx.Request("GET", "https://provider.example/test")
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError("failed", request=request, response=response)

    def json(self):
        return self._payload


class RecordingClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    async def post(self, path, **kwargs):
        self.requests.append(("POST", path, kwargs))
        return self.responses.pop(0)

    async def get(self, path, **kwargs):
        self.requests.append(("GET", path, kwargs))
        return self.responses.pop(0)


class ClientFactory:
    def __init__(self, client):
        self.client = client
        self.calls = []

    @asynccontextmanager
    async def __call__(self, *, base_url, timeout):
        self.calls.append({"base_url": base_url, "timeout": timeout})
        yield self.client


def candidate(kind="llm", **overrides):
    values = {
        "name": "Unsaved Provider",
        "enabled": True,
        "base_url": "https://candidate.example/private/path?token=hidden",
        "model": "unsaved-model",
        "api_key": "candidate-secret",
        "ssh_host": "tts-candidate" if kind == "tts" else None,
    }
    values.update(overrides)
    return ProviderChannel(**values)


@pytest.mark.anyio
async def test_llm_uses_unsaved_values_and_minimal_deterministic_request():
    client = RecordingClient([FakeResponse(payload={"content": [{"text": "ok"}]})])
    client_factory = ClientFactory(client)
    captured = []

    def provider_factory(kind, channel, http_client):
        captured.append((kind, channel, http_client))
        return http_client

    moments = iter(
        [datetime(2026, 7, 11, tzinfo=UTC), datetime(2026, 7, 11, tzinfo=UTC) + timedelta(milliseconds=7)]
    )
    service = ProviderChannelTestingService(
        stored_channel=lambda kind: candidate(kind, api_key="stored-secret"),
        clock=lambda: next(moments),
        provider_factory=provider_factory,
        client_factory=client_factory,
    )

    result = await service.test("llm", candidate())

    assert result.status == "ok"
    assert result.model == "unsaved-model"
    assert result.host == "candidate.example"
    assert result.elapsed_ms == 7
    assert result.check_scope == "model"
    assert captured[0][0] == "llm"
    assert captured[0][1].api_key_value == "candidate-secret"
    method, path, request = client.requests[0]
    assert (method, path) == ("POST", "v1/messages")
    assert request["json"] == {
        "model": "unsaved-model",
        "max_tokens": 1,
        "temperature": 0,
        "messages": [{"role": "user", "content": "ping"}],
    }
    assert request["headers"]["x-api-key"] == "candidate-secret"
    timeout = client_factory.calls[0]["timeout"]
    assert timeout.connect == 2
    assert timeout.read == 8


@pytest.mark.anyio
async def test_blank_key_resolves_stored_key_without_persisting():
    client = RecordingClient([FakeResponse(payload={"content": [{"text": "ok"}]})])
    client_factory = ClientFactory(client)
    stored = candidate(api_key="stored-secret")
    observed = []

    service = ProviderChannelTestingService(
        stored_channel=lambda kind: stored,
        provider_factory=lambda kind, channel, http_client: observed.append(channel) or http_client,
        client_factory=client_factory,
    )

    result = await service.test("llm", candidate(api_key=""))

    assert result.status == "ok"
    assert observed[0].api_key_value == "stored-secret"
    assert stored.api_key_value == "stored-secret"


@pytest.mark.anyio
async def test_clear_key_does_not_resolve_stored_key_or_open_connection():
    class UnusedClientFactory:
        def __call__(self, **kwargs):
            raise AssertionError("cleared key must fail before opening a connection")

    service = ProviderChannelTestingService(
        stored_channel=lambda kind: candidate(kind, api_key="stored-secret"),
        client_factory=UnusedClientFactory(),
    )
    update = ProviderChannelUpdate(
        name="Unsaved Provider",
        enabled=True,
        base_url="https://candidate.example/v1",
        model="unsaved-model",
        clear_api_key=True,
    )

    result = await service.test("llm", update)

    assert result.status == "failed"
    assert result.error == "Enabled llm channel requires an api_key"


@pytest.mark.anyio
async def test_image_checks_capabilities_without_generating_an_image():
    client = RecordingClient([FakeResponse(payload={"id": "unsaved-model"})])
    service = ProviderChannelTestingService(
        stored_channel=lambda kind: candidate(kind),
        provider_factory=lambda kind, channel, http_client: http_client,
        client_factory=ClientFactory(client),
    )

    result = await service.test("image", candidate("image"))

    assert result.status == "ok"
    assert result.check_scope == "model"
    assert client.requests == [("GET", "v1/models/unsaved-model", {"headers": {"Authorization": "Bearer candidate-secret"}})]
    assert all("generations" not in path for _, path, _ in client.requests)


@pytest.mark.anyio
@pytest.mark.parametrize("root_status", [200, 401, 404])
async def test_image_falls_back_to_endpoint_reachability_when_capabilities_absent(
    root_status,
):
    client = RecordingClient([FakeResponse(404), FakeResponse(root_status)])
    service = ProviderChannelTestingService(
        stored_channel=lambda kind: candidate(kind),
        provider_factory=lambda kind, channel, http_client: http_client,
        client_factory=ClientFactory(client),
    )

    result = await service.test("image", candidate("image"))

    assert result.status == "ok"
    assert result.check_scope == "endpoint"
    assert [request[:2] for request in client.requests] == [
        ("GET", "v1/models/unsaved-model"),
        ("GET", ""),
    ]


@pytest.mark.anyio
async def test_image_endpoint_fallback_rejects_server_errors():
    client = RecordingClient([FakeResponse(404), FakeResponse(503)])
    service = ProviderChannelTestingService(
        stored_channel=lambda kind: candidate(kind),
        provider_factory=lambda kind, channel, http_client: http_client,
        client_factory=ClientFactory(client),
    )

    result = await service.test("image", candidate("image"))

    assert result.status == "failed"
    assert result.check_scope == "endpoint"
    assert result.error == "Provider returned HTTP 503"


@pytest.mark.anyio
async def test_tts_uses_short_phrase_validates_wav_and_discards_bytes():
    wav = b"RIFF\x04\x00\x00\x00WAVE"
    client = RecordingClient(
        [FakeResponse(content=wav, headers={"content-type": "audio/wav"})]
    )
    service = ProviderChannelTestingService(
        stored_channel=lambda kind: candidate(kind),
        provider_factory=lambda kind, channel, http_client: http_client,
        client_factory=ClientFactory(client),
    )

    result = await service.test("tts", candidate("tts", api_key=None))

    assert result.status == "ok"
    assert result.check_scope == "audio"
    assert not hasattr(result, "content")
    _, path, request = client.requests[0]
    assert path == "/v1/audio/speech"
    assert request["json"] == {
        "model": "unsaved-model",
        "text": "测试",
        "speaker": "Dylan",
        "language": "Chinese",
        "instruct": "",
        "response_format": "wav",
    }


@pytest.mark.anyio
@pytest.mark.parametrize("failure", ["transport", "502"])
async def test_tts_uses_configured_ssh_fallback_and_discards_wav(failure):
    wav = b"RIFF\x04\x00\x00\x00WAVE"

    class TransportFailureClient:
        async def post(self, path, **kwargs):
            request = httpx.Request("POST", f"https://tts.example{path}")
            if failure == "transport":
                raise httpx.ConnectError("direct unavailable", request=request)
            return httpx.Response(502, request=request)

    ssh_calls = []

    def ssh_executor(command, payload):
        ssh_calls.append((command, payload))
        return base64.b64encode(wav)

    service = ProviderChannelTestingService(
        stored_channel=lambda kind: candidate(kind),
        client_factory=ClientFactory(TransportFailureClient()),
        ssh_executor=ssh_executor,
    )

    result = await service.test("tts", candidate("tts", api_key=None))

    assert result.status == "ok"
    assert result.check_scope == "audio"
    assert ssh_calls[0][0][0:2] == ["ssh", "tts-candidate"]
    assert not hasattr(result, "content")


@pytest.mark.anyio
async def test_tts_ssh_timeouts_finish_workers_without_accumulating():
    class TransportFailureClient:
        async def post(self, path, **kwargs):
            request = httpx.Request("POST", f"https://tts.example{path}")
            raise httpx.ConnectError("direct unavailable", request=request)

    lock = threading.Lock()
    active = 0
    max_active = 0
    passed_timeouts = []

    def bounded_runner(command, **kwargs):
        nonlocal active, max_active
        timeout = kwargs["timeout"]
        passed_timeouts.append(timeout)
        with lock:
            active += 1
            max_active = max(max_active, active)
        try:
            time.sleep(timeout)
            raise subprocess.TimeoutExpired(command, timeout)
        finally:
            with lock:
                active -= 1

    service = ProviderChannelTestingService(
        stored_channel=lambda kind: candidate(kind),
        client_factory=ClientFactory(TransportFailureClient()),
        subprocess_runner=bounded_runner,
        ssh_timeout_margin_seconds=0.03,
        total_timeout_seconds=0.08,
    )

    started_at = time.perf_counter()
    results = [
        await service.test("tts", candidate("tts", api_key=None))
        for _ in range(3)
    ]
    wall_seconds = time.perf_counter() - started_at

    assert wall_seconds < 0.3
    assert all(result.status == "failed" for result in results)
    assert all(result.error == "Connection timed out" for result in results)
    assert len(passed_timeouts) == 3
    assert all(0 < timeout < 0.08 for timeout in passed_timeouts)
    assert active == 0
    assert max_active == 1


@pytest.mark.anyio
@pytest.mark.parametrize(
    "invalid_wav",
    [
        b"RIFF",
        b"RIFF\x04\x00\x00\x00NOPE",
    ],
)
async def test_tts_rejects_truncated_or_non_wave_riff(invalid_wav):
    client = RecordingClient(
        [
            FakeResponse(
                content=invalid_wav,
                headers={"content-type": "audio/wav"},
            )
        ]
    )
    service = ProviderChannelTestingService(
        stored_channel=lambda kind: candidate(kind),
        client_factory=ClientFactory(client),
    )

    result = await service.test("tts", candidate("tts", api_key=None))

    assert result.status == "failed"
    assert result.error == "TTS returned invalid WAV data"


@pytest.mark.anyio
async def test_failure_is_sanitized_and_does_not_expose_credentials_or_url_details():
    secret = "never-return-this-secret"

    class FailingClient(RecordingClient):
        async def post(self, path, **kwargs):
            raise httpx.ConnectError(
                f"failed {secret} https://candidate.example/private/path?token=hidden"
            )

    service = ProviderChannelTestingService(
        stored_channel=lambda kind: candidate(kind),
        provider_factory=lambda kind, channel, http_client: http_client,
        client_factory=ClientFactory(FailingClient([])),
    )

    result = await service.test("llm", candidate(api_key=secret))

    serialized = json.dumps(result.model_dump())
    assert result.status == "failed"
    assert result.error == "Connection failed (ConnectError)"
    assert secret not in serialized
    assert "/private/path" not in serialized
    assert "token=hidden" not in serialized


@pytest.mark.anyio
async def test_provider_value_error_is_not_echoed():
    secret = "provider-body-secret"

    class InvalidResponse(FakeResponse):
        def json(self):
            raise ValueError(f"invalid body contained {secret}")

    service = ProviderChannelTestingService(
        stored_channel=lambda kind: candidate(kind),
        provider_factory=lambda kind, channel, http_client: http_client,
        client_factory=ClientFactory(RecordingClient([InvalidResponse()])),
    )

    result = await service.test("llm", candidate())

    assert result.status == "failed"
    assert result.error == "Provider returned an invalid response"
    assert secret not in json.dumps(result.model_dump())


@pytest.mark.anyio
async def test_total_timeout_cuts_off_complete_provider_check_without_leaking():
    secret = "slow-provider-secret"

    class SlowClient:
        async def post(self, path, **kwargs):
            await asyncio.sleep(1)
            raise AssertionError("timeout did not stop the request")

    service = ProviderChannelTestingService(
        stored_channel=lambda kind: candidate(kind),
        provider_factory=lambda kind, channel, http_client: http_client,
        client_factory=ClientFactory(SlowClient()),
        total_timeout_seconds=0.01,
    )

    started_at = time.perf_counter()
    result = await service.test("llm", candidate(api_key=secret))
    wall_seconds = time.perf_counter() - started_at

    assert wall_seconds < 0.2
    assert result.status == "failed"
    assert result.error == "Connection timed out"
    assert secret not in json.dumps(result.model_dump())


def channel_payload(**overrides):
    payload = {
        "name": "Candidate",
        "enabled": True,
        "base_url": "https://candidate.example/private/path?token=hidden",
        "model": "candidate-model",
        "api_key": "response-secret",
    }
    payload.update(overrides)
    return payload


def test_endpoint_returns_failed_transport_as_redacted_200_without_persistence(client, monkeypatch):
    store = client.app.state.provider_channel_store
    saved = store.snapshot.model_copy(
        update={
            "llm": store.snapshot.llm.model_copy(
                update={"enabled": True, "api_key": "stored-secret"}
            )
        }
    )
    store.save(saved)
    saved_snapshot = store.snapshot
    before_file = store._path.read_bytes()
    with client.app.state.session_factory() as session:
        before_assets = session.query(models.Asset).count()
        before_jobs = session.query(models.Job).count()

    @asynccontextmanager
    async def failing_client_factory(**kwargs):
        class FailingClient:
            async def post(self, path, **request):
                raise httpx.ConnectTimeout(
                    "response-secret /private/path?token=hidden"
                )

        yield FailingClient()

    monkeypatch.setattr(
        "comic_studio.routes.provider_channels.provider_testing_client_factory",
        failing_client_factory,
    )

    response = client.post(
        "/api/provider-channels/llm/test",
        json=channel_payload(),
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "failed",
        "model": "candidate-model",
        "host": "candidate.example",
        "elapsed_ms": response.json()["elapsed_ms"],
        "check_scope": "model",
        "error": "Connection failed (ConnectTimeout)",
    }
    assert isinstance(response.json()["elapsed_ms"], int)
    assert "response-secret" not in response.text
    assert "/private/path" not in response.text
    assert "token=hidden" not in response.text
    assert store._path.read_bytes() == before_file
    assert store.snapshot == saved_snapshot
    with client.app.state.session_factory() as session:
        assert session.query(models.Asset).count() == before_assets
        assert session.query(models.Job).count() == before_jobs


def test_endpoint_returns_sanitized_timeout_as_200(client, monkeypatch):
    secret = "endpoint-timeout-secret"

    @asynccontextmanager
    async def slow_client_factory(**kwargs):
        class SlowClient:
            async def post(self, path, **request):
                await asyncio.sleep(1)

        yield SlowClient()

    monkeypatch.setattr(
        "comic_studio.routes.provider_channels.provider_testing_client_factory",
        slow_client_factory,
    )
    monkeypatch.setattr(
        "comic_studio.routes.provider_channels.provider_testing_total_timeout_seconds",
        0.01,
    )

    started_at = time.perf_counter()
    response = client.post(
        "/api/provider-channels/llm/test",
        json=channel_payload(api_key=secret),
    )
    wall_seconds = time.perf_counter() - started_at

    assert wall_seconds < 0.2
    assert response.status_code == 200
    assert response.json()["status"] == "failed"
    assert response.json()["error"] == "Connection timed out"
    assert secret not in response.text


def test_endpoint_rejects_invalid_candidate_with_422_and_no_secret(client):
    response = client.post(
        "/api/provider-channels/llm/test",
        json=channel_payload(api_key="validation-secret", base_url="not-a-url"),
    )

    assert response.status_code == 422
    assert "validation-secret" not in response.text


@pytest.mark.parametrize("field", ["name", "model"])
@pytest.mark.parametrize("value", ["", "   "])
def test_endpoint_rejects_blank_required_identity_fields(client, field, value):
    response = client.post(
        "/api/provider-channels/llm/test",
        json=channel_payload(**{field: value}),
    )

    assert response.status_code == 422


@pytest.mark.parametrize(
    "secret_operation",
    [
        {"api_key": ""},
        {"api_key": "", "clear_api_key": True},
    ],
)
def test_endpoint_rejects_enabled_channel_without_effective_key(
    client,
    secret_operation,
):
    store = client.app.state.provider_channel_store
    snapshot = store.snapshot
    store.save(
        snapshot.model_copy(
            update={
                "llm": snapshot.llm.model_copy(
                    update={"enabled": False, "api_key": None}
                )
            }
        )
    )
    response = client.post(
        "/api/provider-channels/llm/test",
        json=channel_payload(**secret_operation),
    )

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "Enabled llm channel requires an api_key"
    )
