from dataclasses import dataclass

from comic_studio.model_runtime.contracts import Capability
from comic_studio.model_runtime.errors import ModelRuntimeError, RuntimeErrorCode


@dataclass
class FakeJob:
    id: str = "job-1"
    status: str = "queued"
    request_payload: dict | None = None


class FakeRuntime:
    def __init__(self):
        self.error = None
        self.created = None

    def create_media_job(self, capability, target_type, target_id, payload):
        if self.error:
            raise self.error
        self.created = (capability, target_type, target_id, payload)
        return FakeJob(request_payload={"capability": capability.value, **payload})

    async def run_media_job(self, _job_id):
        return None

    async def health(self):
        return {
            "capabilities": {},
            "infrastructure": {},
            "checked_at": "2026-07-12T00:00:00Z",
        }

    def read_channels(self):
        return {
            "text": {"name": "Text", "enabled": True, "base_url": "https://text.example.com", "model": "M3", "ssh_host": "", "api_key_configured": True, "api_key_masked": "sk-****"},
            "image": {"name": "Image", "enabled": True, "base_url": "https://image.example.com", "model": "image", "ssh_host": "", "api_key_configured": True, "api_key_masked": "sk-****"},
            "speech": {"name": "Speech", "enabled": False, "base_url": "http://localhost:8000", "model": "tts", "ssh_host": "", "api_key_configured": False, "api_key_masked": ""},
            "video": {"name": "Video", "enabled": False, "base_url": "https://video.example.com", "model": "video", "ssh_host": "", "api_key_configured": False, "api_key_masked": ""},
            "persistence": {"status": "saved"},
            "reloaded_at": "2026-07-12T00:00:00Z",
        }


def test_image_runtime_returns_normalized_accepted_job(client):
    runtime = FakeRuntime()
    client.app.state.model_runtime = runtime

    response = client.post(
        "/api/model-runtime/image",
        json={"target_type": "shot", "target_id": "s1", "activate": True},
    )

    assert response.status_code == 202
    assert response.json() == {
        "job_id": "job-1",
        "capability": "image",
        "status": "queued",
    }
    assert runtime.created[0] is Capability.IMAGE


def test_runtime_error_uses_stable_error_envelope(client):
    runtime = FakeRuntime()
    runtime.error = ModelRuntimeError(
        RuntimeErrorCode.CONFIGURATION_ERROR,
        "image capability is not configured",
        False,
        Capability.IMAGE,
        "gpt-image",
    )
    client.app.state.model_runtime = runtime

    response = client.post(
        "/api/model-runtime/image",
        json={"target_type": "shot", "target_id": "s1"},
    )

    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "configuration_error",
            "message": "image capability is not configured",
            "retryable": False,
            "capability": "image",
            "provider": "gpt-image",
        }
    }


def test_runtime_health_separates_infrastructure(client):
    client.app.state.model_runtime = FakeRuntime()

    response = client.get("/api/model-runtime/health")

    assert response.status_code == 200
    assert set(response.json()) == {"capabilities", "infrastructure", "checked_at"}


def test_legacy_channel_read_delegates_to_runtime(client):
    runtime = FakeRuntime()
    client.app.state.model_runtime = runtime

    response = client.get("/api/provider-channels")

    assert response.status_code == 200
    assert response.json()["llm"]["model"] == "M3"


def test_legacy_provider_health_delegates_to_runtime(client):
    class HealthyRuntime(FakeRuntime):
        async def health(self):
            return {
                "capabilities": {
                    kind: {"status": "healthy", "model": kind, "host": "local", "elapsed_ms": 4, "error": None}
                    for kind in ("text", "image", "speech", "video")
                },
                "infrastructure": {},
                "checked_at": "2026-07-12T00:00:00Z",
            }

    client.app.state.model_runtime = HealthyRuntime()
    response = client.get("/api/providers/health")

    assert response.status_code == 200
    assert response.json()["llm"]["status"] == "ok"
