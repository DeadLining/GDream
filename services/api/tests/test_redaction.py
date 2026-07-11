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


def test_redacts_unquoted_and_composite_secrets_without_swallowing_context():
    error = (
        "Provider failed: api_key=raw-key, token: raw-token; "
        "access_token=access-value refreshToken: refresh-value, "
        "client_secret=client-value} proxyAuthorization: proxy-value] retry later"
    )

    redacted = redact(error)

    assert redacted == (
        "Provider failed: api_key=[REDACTED], token: [REDACTED]; "
        "access_token=[REDACTED] refreshToken: [REDACTED], "
        "client_secret=[REDACTED]} proxyAuthorization: [REDACTED]] retry later"
    )
    for secret in (
        "raw-key",
        "raw-token",
        "access-value",
        "refresh-value",
        "client-value",
        "proxy-value",
    ):
        assert secret not in redacted


def test_redacts_bearer_value_while_preserving_authorization_prefix():
    assert redact("Authorization: Bearer bearer-secret} request failed") == (
        "Authorization: Bearer [REDACTED]} request failed"
    )


def test_redacts_normalized_mapping_keys_recursively_without_false_positives():
    value = {
        "apiKey": "top-secret",
        "nested": {
            "clientSecret": "nested-secret",
            "access-token": "access-secret",
            "monkey": "visible",
        },
    }

    assert redact(value) == {
        "apiKey": "[REDACTED]",
        "nested": {
            "clientSecret": "[REDACTED]",
            "access-token": "[REDACTED]",
            "monkey": "visible",
        },
    }


def test_redacts_normalized_unquoted_string_fields_without_matching_monkey():
    error = (
        "apiKey=camel-key clientSecret: client-secret; "
        "service-api-key=service-key, monkey=visible"
    )

    assert redact(error) == (
        "apiKey=[REDACTED] clientSecret: [REDACTED]; "
        "service-api-key=[REDACTED], monkey=visible"
    )
