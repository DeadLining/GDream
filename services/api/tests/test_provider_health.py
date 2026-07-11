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
