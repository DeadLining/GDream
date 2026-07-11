def test_provider_health_returns_models_without_credentials(client):
    response = client.get("/api/providers/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["llm"]["model"] == "MiniMax-M3"
    assert payload["image"]["model"] == "gpt-image-2"
    assert payload["tts"]["model"] == "Qwen3-TTS-12Hz-1.7B-CustomVoice"
    serialized = str(payload).lower()
    assert "api_key" not in serialized
    assert "sk-" not in serialized


def test_provider_health_reads_current_channel_snapshot(client):
    store = client.app.state.provider_channel_store
    current = store.snapshot
    store.save(
        current.model_copy(
            update={
                "llm": current.llm.model_copy(
                    update={
                        "enabled": False,
                        "model": "runtime-model",
                        "base_url": "https://runtime.example:8443/v1",
                    }
                )
            }
        )
    )

    response = client.get("/api/providers/health")

    assert response.status_code == 200
    assert response.json()["llm"] == {
        "status": "disabled",
        "model": "runtime-model",
        "host": "runtime.example",
        "port": 8443,
    }
