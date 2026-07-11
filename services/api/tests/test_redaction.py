from comic_studio.redaction import redact


def test_redacts_api_keys_from_nested_provider_errors():
    data = {
        "error": "Authorization Bearer sk-secret-value",
        "request": {"api_key": "sk-other", "model": "MiniMax-M3"},
    }

    assert redact(data) == {
        "error": "Authorization Bearer [REDACTED]",
        "request": {"api_key": "[REDACTED]", "model": "MiniMax-M3"},
    }
