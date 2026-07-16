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

    def latest_model3d_job(self, target_type, target_id):
        self.latest_target = (target_type, target_id)
        return FakeJob(
            id="job-latest",
            status="succeeded",
            request_payload={"capability": "model3d"},
        )

    def approve_model3d_job(self, job_id):
        self.approved_model3d_job_id = job_id
        return {"review_status": "approved", "is_active": True}

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
            "model3d": {"name": "3D", "enabled": False, "base_url": "https://fal.run", "model": "fal-ai/triposr", "ssh_host": "", "api_key_configured": False, "api_key_masked": ""},
            "persistence": {"status": "saved"},
            "reloaded_at": "2026-07-12T00:00:00Z",
        }

    async def suggest_asset_variant(self, payload):
        self.suggestion_payload = payload
        return {
            "kind": "episode",
            "label": "第 01 集唐代造型",
            "summary": "保留身份特征，替换为唐代书生服装。",
            "inherited_fields": ["identity", "face"],
            "overrides": {"outfit": "唐代书生服装"},
            "state_kind": None,
            "assistant_message": "建议创建为集级变体。",
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


def test_image_runtime_accepts_a_library_asset_target(client):
    runtime = FakeRuntime()
    client.app.state.model_runtime = runtime

    response = client.post(
        "/api/model-runtime/image",
        json={"target_type": "library_asset", "target_id": "scene-asset-1"},
    )

    assert response.status_code == 202
    assert runtime.created[:3] == (
        Capability.IMAGE,
        "library_asset",
        "scene-asset-1",
    )


def test_character_reference_set_mode_is_passed_to_runtime(client):
    runtime = FakeRuntime()
    client.app.state.model_runtime = runtime

    response = client.post(
        "/api/model-runtime/image",
        json={
            "target_type": "character",
            "target_id": "c1",
            "mode": "reference_set",
        },
    )

    assert response.status_code == 202
    assert runtime.created == (
        Capability.IMAGE,
        "character",
        "c1",
        {
            "activate": True,
            "reference_type": "primary",
            "label": "",
            "mode": "reference_set",
        },
    )


def test_character_reference_set_mode_rejects_shot_target(client):
    client.app.state.model_runtime = FakeRuntime()

    response = client.post(
        "/api/model-runtime/image",
        json={
            "target_type": "shot",
            "target_id": "s1",
            "mode": "reference_set",
        },
    )

    assert response.status_code == 422


def test_model3d_runtime_queues_a_non_activating_candidate(client):
    runtime = FakeRuntime()
    client.app.state.model_runtime = runtime

    response = client.post(
        "/api/model-runtime/model3d",
        json={
            "target_type": "character",
            "target_id": "c1",
            "reference_asset_id": "asset-reference-1",
            "reference_asset_ids": [
                "asset-reference-1",
                "asset-reference-side",
            ],
        },
    )

    assert response.status_code == 202
    assert response.json() == {
        "job_id": "job-1",
        "capability": "model3d",
        "status": "queued",
    }
    assert runtime.created == (
        Capability.MODEL_3D,
        "character",
        "c1",
        {
            "reference_asset_id": "asset-reference-1",
            "reference_asset_ids": [
                "asset-reference-1",
                "asset-reference-side",
            ],
        },
    )


def test_model3d_runtime_rejects_unsupported_targets(client):
    client.app.state.model_runtime = FakeRuntime()

    response = client.post(
        "/api/model-runtime/model3d",
        json={"target_type": "shot", "target_id": "s1"},
    )

    assert response.status_code == 422


def test_model3d_runtime_returns_the_latest_persisted_target_job(client):
    runtime = FakeRuntime()
    client.app.state.model_runtime = runtime

    response = client.get(
        "/api/model-runtime/model3d/latest",
        params={"target_type": "library_asset", "target_id": "prop-1"},
    )

    assert response.status_code == 200
    assert response.json()["id"] == "job-latest"
    assert runtime.latest_target == ("library_asset", "prop-1")


def test_model3d_runtime_approves_a_completed_candidate(client):
    runtime = FakeRuntime()
    client.app.state.model_runtime = runtime

    response = client.post("/api/model-runtime/model3d/jobs/job-3d/approve")

    assert response.status_code == 200
    assert response.json() == {"review_status": "approved", "is_active": True}
    assert runtime.approved_model3d_job_id == "job-3d"


def test_asset_variant_suggestion_returns_a_structured_ai_draft(client):
    runtime = FakeRuntime()
    client.app.state.model_runtime = runtime

    response = client.post(
        "/api/model-runtime/asset-variant/suggest",
        json={
            "character_id": "c1",
            "episode_id": "e1",
            "message": "第一集换成唐代书生服装，保持脸型。",
            "character": {"name": "林夏", "appearance_bible": "黑色风衣"},
            "episode": {"title": "雨夜危机"},
            "conversation": [],
            "annotations": [],
        },
    )

    assert response.status_code == 200
    assert response.json()["kind"] == "episode"
    assert response.json()["overrides"] == {"outfit": "唐代书生服装"}
    assert runtime.suggestion_payload["message"] == "第一集换成唐代书生服装，保持脸型。"


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
                    for kind in ("text", "image", "speech", "video", "model3d")
                },
                "infrastructure": {},
                "checked_at": "2026-07-12T00:00:00Z",
            }

    client.app.state.model_runtime = HealthyRuntime()
    response = client.get("/api/providers/health")

    assert response.status_code == 200
    assert response.json()["llm"]["status"] == "ok"
