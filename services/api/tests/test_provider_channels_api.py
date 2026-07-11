import json

import pytest


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


def test_get_returns_redacted_channels_and_sanitized_metadata(client):
    secret = "full-secret-8adr"
    store = seed_channels(client, llm_key=secret)

    response = client.get("/api/provider-channels")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"llm", "image", "tts", "persistence", "reloaded_at"}
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
        ("abcde", "*bcde"),
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


@pytest.mark.parametrize("kind", ["video", "LLM", "llm/extra"])
def test_put_rejects_invalid_channel_kind(client, kind):
    response = client.put(f"/api/provider-channels/{kind}", json=channel_update())

    assert response.status_code == 422


def test_put_rejects_extra_fields(client):
    response = client.put(
        "/api/provider-channels/llm",
        json=channel_update(unexpected=True),
    )

    assert response.status_code == 422


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
