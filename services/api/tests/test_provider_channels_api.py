import json
import threading
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from comic_studio.config import get_settings
from comic_studio.main import create_app
from comic_studio.main import (
    _sanitize_validation_value,
    _validation_field_is_sensitive,
)


def channel_update(**overrides):
    payload = {
        "name": "Updated provider",
        "enabled": True,
        "base_url": "https://providers.example.com/v1",
        "model": "updated-model",
    }
    payload.update(overrides)
    return payload


def seed_channels(client, *, llm_key="full-secret-8adr", image_key="image-secret"):
    store = client.app.state.provider_channel_store
    snapshot = store.snapshot
    store.save(
        snapshot.model_copy(
            update={
                "llm": snapshot.llm.model_copy(
                    update={"enabled": True, "api_key": llm_key}
                ),
                "image": snapshot.image.model_copy(
                    update={"enabled": True, "api_key": image_key}
                ),
            }
        )
    )
    return store


def test_temporary_path_restart_smoke_keeps_json_authoritative_and_redacted(
    tmp_path, monkeypatch, caplog
):
    config_path = tmp_path / "provider-channels.json"
    bootstrap_key = "bootstrap-smoke-key"
    saved_key = "saved-smoke-key-never-return"
    monkeypatch.setenv("AI_COMIC_DATABASE_URL", f"sqlite:///{tmp_path / 'studio.db'}")
    monkeypatch.setenv("AI_COMIC_DATA_ROOT", str(tmp_path / "data"))
    monkeypatch.setenv("AI_COMIC_PROVIDER_CHANNELS_PATH", str(config_path))
    monkeypatch.setenv("MINIMAX_API_KEY", bootstrap_key)
    monkeypatch.setenv("MINIMAX_MODEL", "bootstrap-model")

    get_settings.cache_clear()
    with TestClient(create_app()) as first_client:
        initial = first_client.get("/api/provider-channels")
        assert initial.status_code == 200
        assert initial.json()["llm"]["model"] == "bootstrap-model"
        assert initial.json()["persistence"]["status"] == "defaults"
        saved = first_client.put(
            "/api/provider-channels/llm",
            json=channel_update(model="saved-model", api_key=saved_key),
        )
        assert saved.status_code == 200

    monkeypatch.setenv("MINIMAX_API_KEY", "changed-environment-key")
    monkeypatch.setenv("MINIMAX_MODEL", "changed-environment-model")
    get_settings.cache_clear()
    caplog.clear()
    with TestClient(create_app()) as restarted_client:
        reloaded = restarted_client.get("/api/provider-channels")
        assert reloaded.status_code == 200
        assert reloaded.json()["llm"]["model"] == "saved-model"
        assert reloaded.json()["persistence"]["status"] == "saved"
        assert saved_key not in reloaded.text
        assert saved_key not in caplog.text

    persisted = json.loads(config_path.read_text(encoding="utf-8"))
    assert persisted["llm"]["model"] == "saved-model"
    assert persisted["llm"]["api_key"] == saved_key
    assert config_path.stat().st_mode & 0o777 == 0o600
    get_settings.cache_clear()


def test_get_returns_redacted_channels_and_sanitized_metadata(client):
    secret = "full-secret-8adr"
    store = seed_channels(client, llm_key=secret)

    response = client.get("/api/provider-channels")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"llm", "image", "tts", "video", "persistence", "reloaded_at"}
    assert body["llm"]["api_key_configured"] is True
    assert body["llm"]["api_key_masked"].endswith("8adr")
    assert "api_key" not in body["llm"]
    assert body["tts"]["api_key_configured"] is False
    assert body["tts"]["api_key_masked"] == ""
    assert body["persistence"] == {
        "status": "saved",
        "file_path": "provider-channels.json",
    }
    assert body["reloaded_at"].endswith("Z")
    assert secret not in response.text
    assert str(store._path.parent) not in response.text


def test_get_reports_defaults_when_configuration_file_is_absent(client):
    response = client.get("/api/provider-channels")

    assert response.status_code == 200
    assert response.json()["persistence"] == {
        "status": "defaults",
        "file_path": "provider-channels.json",
    }


@pytest.mark.parametrize(
    ("secret", "expected"),
    [
        ("a", "*"),
        ("abcd", "****"),
        ("abcde", "*****"),
        ("abcdefgh", "********"),
        ("sk-example-secret-8adr", "sk-****8adr"),
    ],
)
def test_get_masks_short_and_long_keys_without_leaking(client, secret, expected):
    seed_channels(client, llm_key=secret)

    response = client.get("/api/provider-channels")

    assert response.json()["llm"]["api_key_masked"] == expected
    assert "api_key" not in {
        key
        for key in response.json()["llm"]
        if key not in {"api_key_configured", "api_key_masked"}
    }


@pytest.mark.parametrize("api_key_field", [{}, {"api_key": ""}, {"api_key": "   "}])
def test_put_blank_or_omitted_key_preserves_existing_secret(client, api_key_field):
    secret = "preserve-this-secret"
    store = seed_channels(client, llm_key=secret)
    payload = channel_update(**api_key_field)

    response = client.put("/api/provider-channels/llm", json=payload)

    assert response.status_code == 200
    assert store.snapshot.llm.api_key_value == secret
    assert response.json()["channel"]["api_key_configured"] is True
    assert response.json()["current"]["llm"]["model"] == "updated-model"
    assert secret not in response.text


def test_put_nonempty_key_replaces_existing_secret_and_persists_full_document(client):
    store = seed_channels(client, llm_key="old-secret", image_key="keep-image-secret")

    response = client.put(
        "/api/provider-channels/llm",
        json=channel_update(api_key=" replacement-secret "),
    )

    assert response.status_code == 200
    assert store.snapshot.llm.api_key_value == "replacement-secret"
    persisted = json.loads(store._path.read_text(encoding="utf-8"))
    assert persisted["llm"]["api_key"] == "replacement-secret"
    assert persisted["image"]["api_key"] == "keep-image-secret"
    assert "replacement-secret" not in response.text


def test_put_clear_key_removes_secret_for_disabled_channel(client):
    store = seed_channels(client, llm_key="remove-me")

    response = client.put(
        "/api/provider-channels/llm",
        json=channel_update(enabled=False, clear_api_key=True),
    )

    assert response.status_code == 200
    assert store.snapshot.llm.api_key_value is None
    assert response.json()["channel"]["api_key_configured"] is False
    assert "remove-me" not in response.text


def test_put_rejects_replacement_and_clear_together_without_leaking_key(client):
    secret = "never-return-this-secret"

    response = client.put(
        "/api/provider-channels/llm",
        json=channel_update(api_key=secret, clear_api_key=True),
    )

    assert response.status_code == 422
    assert secret not in response.text


@pytest.mark.parametrize(
    "malformed_secret",
    [
        ["list-secret-value"],
        {"nested": ["dict-secret-value"]},
    ],
)
def test_put_redacts_malformed_api_key_input(client, malformed_secret, caplog):
    secret_text = json.dumps(malformed_secret)

    response = client.put(
        "/api/provider-channels/llm",
        json=channel_update(enabled=False, api_key=malformed_secret),
    )

    assert response.status_code == 422
    error = response.json()["detail"][0]
    assert error["loc"] == ["body", "api_key"]
    assert error["msg"] == "Input should be a valid string"
    assert error["input"] == "[REDACTED]"
    assert secret_text not in response.text
    assert secret_text not in caplog.text


@pytest.mark.parametrize("field_name", ["apiKey", "api-key", "apikey", "credential"])
def test_validation_redacts_normalized_secret_field_names(client, field_name):
    secret = f"arbitrary-{field_name}-value"

    response = client.put(
        "/api/provider-channels/llm",
        json=channel_update(enabled=False, **{field_name: secret}),
    )

    assert response.status_code == 422
    error = next(
        item for item in response.json()["detail"] if item["loc"][-1] == field_name
    )
    assert error["input"] == "[REDACTED]"
    assert secret not in response.text


@pytest.mark.parametrize(
    "field_name",
    ["access_token", "refreshToken", "client_secret", "proxyAuthorization"],
)
def test_validation_redacts_composite_secret_field_names(client, field_name):
    secret = f"composite-{field_name}-value"

    response = client.put(
        "/api/provider-channels/llm",
        json=channel_update(enabled=False, **{field_name: secret}),
    )

    assert response.status_code == 422
    error = next(
        item for item in response.json()["detail"] if item["loc"][-1] == field_name
    )
    assert error["input"] == "[REDACTED]"
    assert secret not in response.text


def test_validation_redacts_nested_composite_secrets_in_unknown_field(client):
    secrets = {
        "access_token": "nested-access-value",
        "refreshToken": "nested-refresh-value",
        "client_secret": "nested-client-value",
        "proxyAuthorization": "nested-authorization-value",
    }

    response = client.put(
        "/api/provider-channels/llm",
        json=channel_update(enabled=False, metadata={"nested": secrets}),
    )

    assert response.status_code == 422
    error = next(
        item for item in response.json()["detail"] if item["loc"][-1] == "metadata"
    )
    assert error["input"] == "[REDACTED]"
    assert all(secret not in response.text for secret in secrets.values())


def test_validation_secret_policy_recurses_without_treating_monkey_as_key():
    assert _validation_field_is_sensitive("access_token") is True
    assert _validation_field_is_sensitive("clientSecret") is True
    assert _validation_field_is_sensitive("monkey") is False
    assert _sanitize_validation_value(
        {
            "nested": {"refreshToken": "secret-value", "monkey": "visible"}
        }
    ) == {
        "nested": {"refreshToken": "[REDACTED]", "monkey": "visible"}
    }


def test_validation_redacts_whole_input_for_malformed_json(client):
    secret = "malformed-json-secret-value"
    malformed_body = f'{{"name":"provider","api_key":"{secret}"'

    response = client.put(
        "/api/provider-channels/llm",
        content=malformed_body,
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 422
    error = response.json()["detail"][0]
    assert error["type"] == "json_invalid"
    assert error["input"] == "[REDACTED]"
    assert secret not in response.text


@pytest.mark.parametrize("kind", ["unknown", "LLM", "llm/extra"])
def test_put_rejects_invalid_channel_kind(client, kind):
    response = client.put(f"/api/provider-channels/{kind}", json=channel_update())

    assert response.status_code == 422


def test_put_accepts_direct_wan_video_channel_without_api_key(client):
    response = client.put(
        "/api/provider-channels/video",
        json=channel_update(
            name="Wan2.2 Local",
            base_url="http://192.168.18.94:18081",
            model="Wan-AI/Wan2.2-TI2V-5B",
            clear_api_key=True,
        ),
    )

    assert response.status_code == 200
    assert response.json()["channel"] == {
        "name": "Wan2.2 Local",
        "enabled": True,
        "base_url": "http://192.168.18.94:18081",
        "model": "Wan-AI/Wan2.2-TI2V-5B",
        "ssh_host": "",
        "api_key_configured": False,
        "api_key_masked": "",
    }


def test_put_rejects_extra_fields(client):
    response = client.put(
        "/api/provider-channels/llm",
        json=channel_update(nonsecret_extra="ordinary-value"),
    )

    assert response.status_code == 422
    error = next(
        item
        for item in response.json()["detail"]
        if item["loc"][-1] == "nonsecret_extra"
    )
    assert error["type"] == "extra_forbidden"
    assert error["input"] == "[REDACTED]"


def test_put_rejects_invalid_nonsecret_fields(client):
    response = client.put(
        "/api/provider-channels/llm",
        json=channel_update(base_url="not-a-url", api_key="valid-key"),
    )

    assert response.status_code == 422
    error = response.json()["detail"][0]
    assert error["loc"] == ["body", "base_url"]
    assert error["input"] == "not-a-url"


@pytest.mark.parametrize("kind", ["llm", "image"])
def test_enabled_key_required_channels_need_effective_key(client, kind):
    response = client.put(
        f"/api/provider-channels/{kind}",
        json=channel_update(clear_api_key=True),
    )

    assert response.status_code == 422


def test_disabled_key_required_channel_may_omit_key(client):
    response = client.put(
        "/api/provider-channels/llm",
        json=channel_update(enabled=False),
    )

    assert response.status_code == 200


@pytest.mark.parametrize("kind", ["llm", "image", "tts"])
def test_disabled_channel_accepts_blank_connection_fields(client, kind):
    response = client.put(
        f"/api/provider-channels/{kind}",
        json={
            "name": "",
            "enabled": False,
            "base_url": "",
            "model": "",
            "api_key": "",
        },
    )

    assert response.status_code == 200
    assert response.json()["channel"]["name"] == ""
    assert response.json()["channel"]["base_url"] == ""
    assert response.json()["channel"]["model"] == ""


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"name": ""}, "name"),
        ({"model": ""}, "model"),
        ({"base_url": ""}, "base_url"),
        ({"base_url": "ftp://provider.example"}, "base_url"),
    ],
)
def test_reenabling_channel_validates_required_connection_fields(
    client, overrides, field
):
    disabled = {
        "name": "",
        "enabled": False,
        "base_url": "",
        "model": "",
        "clear_api_key": True,
    }
    assert client.put("/api/provider-channels/llm", json=disabled).status_code == 200

    response = client.put(
        "/api/provider-channels/llm",
        json=channel_update(api_key="new-key", **overrides),
    )

    assert response.status_code == 422
    assert field in response.text


def test_runtime_update_after_json_deletion_preserves_active_other_channels(client):
    store = seed_channels(client)
    active = store.snapshot.model_copy(
        update={
            "image": store.snapshot.image.model_copy(update={"model": "active-image"}),
            "tts": store.snapshot.tts.model_copy(update={"model": "active-tts"}),
        }
    )
    store.save(active)
    store._path.unlink()

    response = client.put(
        "/api/provider-channels/llm",
        json=channel_update(model="updated-llm"),
    )

    assert response.status_code == 200
    assert response.json()["current"]["image"]["model"] == "active-image"
    assert response.json()["current"]["tts"]["model"] == "active-tts"
    persisted = json.loads(store._path.read_text(encoding="utf-8"))
    assert persisted["image"]["model"] == "active-image"
    assert persisted["tts"]["model"] == "active-tts"


def test_put_persistence_is_used_by_runtime_provider_factory(client, monkeypatch):
    captured = []

    class FakeLLM:
        def __init__(self, api_key, *, model, base_url):
            captured.append((api_key, model, base_url))

    client.app.state.provider_factory._llm_provider_class = FakeLLM
    response = client.put(
        "/api/provider-channels/llm",
        json=channel_update(model="runtime-model", api_key="runtime-key"),
    )

    provider = client.app.state.provider_factory.create_llm()

    assert response.status_code == 200
    assert provider is not None
    assert captured == [
        ("runtime-key", "runtime-model", "https://providers.example.com/v1")
    ]


def test_tts_may_be_enabled_without_key_and_accepts_ssh_host(client):
    response = client.put(
        "/api/provider-channels/tts",
        json=channel_update(ssh_host="tts-host"),
    )

    assert response.status_code == 200
    assert response.json()["channel"]["ssh_host"] == "tts-host"


@pytest.mark.parametrize("kind", ["llm", "image"])
def test_ssh_host_is_rejected_outside_tts(client, kind):
    response = client.put(
        f"/api/provider-channels/{kind}",
        json=channel_update(api_key="valid-key", ssh_host="invalid-host"),
    )

    assert response.status_code == 422


def test_put_write_failure_returns_sanitized_500_without_secret_or_path(
    client, monkeypatch
):
    store = seed_channels(client)
    secret = "write-failure-secret"
    private_path = str(store._path)

    def fail_save(_channels):
        raise OSError(f"cannot write {private_path} with {secret}")

    monkeypatch.setattr(store, "save", fail_save)

    response = client.put(
        "/api/provider-channels/llm",
        json=channel_update(api_key=secret),
    )

    assert response.status_code == 500
    assert response.json() == {
        "detail": "Unable to save provider channel configuration"
    }
    assert secret not in response.text
    assert private_path not in response.text


def test_concurrent_put_responses_use_their_exact_committed_snapshots(
    client, monkeypatch
):
    store = seed_channels(client)
    original_image_model = store.snapshot.image.model
    real_update = store.update
    first_committed = threading.Event()
    second_committed = threading.Event()
    responses = {}
    failures = []

    def coordinated_update(mutator):
        result = real_update(mutator)
        snapshot = getattr(result, "channels", result)
        if snapshot.image.model == "image-response-two":
            assert first_committed.wait(timeout=2)
            second_committed.set()
        elif snapshot.llm.model == "llm-response-one":
            first_committed.set()
            assert second_committed.wait(timeout=2)
        return result

    monkeypatch.setattr(store, "update", coordinated_update)

    def put(kind, payload):
        try:
            responses[kind] = client.put(
                f"/api/provider-channels/{kind}", json=payload
            )
        except Exception as error:
            failures.append(error)

    first = threading.Thread(
        target=put,
        args=("llm", channel_update(model="llm-response-one")),
    )
    second = threading.Thread(
        target=put,
        args=("image", channel_update(model="image-response-two")),
    )
    first.start()
    assert first_committed.wait(timeout=2)
    second.start()
    first.join(timeout=2)
    second.join(timeout=2)

    assert failures == []
    assert not first.is_alive()
    assert not second.is_alive()
    first_body = responses["llm"].json()
    second_body = responses["image"].json()
    assert responses["llm"].status_code == 200
    assert responses["image"].status_code == 200
    assert first_body["channel"] == first_body["current"]["llm"]
    assert first_body["current"]["image"]["model"] == original_image_model
    assert second_body["channel"] == second_body["current"]["image"]
    assert second_body["current"]["llm"]["model"] == "llm-response-one"
    assert datetime.fromisoformat(first_body["current"]["reloaded_at"]) < (
        datetime.fromisoformat(second_body["current"]["reloaded_at"])
    )
