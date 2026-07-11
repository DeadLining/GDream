import pytest


def test_local_loopback_preflight_allows_provider_channel_updates(client):
    response = client.options(
        "/api/provider-channels/llm",
        headers={
            "Origin": "http://127.0.0.1:3100",
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == (
        "http://127.0.0.1:3100"
    )
    assert "PUT" in response.headers["access-control-allow-methods"]
    assert "content-type" in response.headers["access-control-allow-headers"].lower()
    assert response.headers.get("access-control-allow-credentials") is None


def test_local_loopback_get_includes_exact_allow_origin(client):
    response = client.get(
        "/api/provider-channels",
        headers={"Origin": "http://127.0.0.1:3100"},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == (
        "http://127.0.0.1:3100"
    )


def test_localhost_origin_allows_arbitrary_port(client):
    response = client.get(
        "/api/provider-channels",
        headers={"Origin": "http://localhost:49152"},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == (
        "http://localhost:49152"
    )


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.com",
        "http://127.0.0.1.evil:3100",
    ],
)
def test_non_loopback_origins_are_not_allowed(client, origin):
    response = client.get(
        "/api/provider-channels",
        headers={"Origin": origin},
    )

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers
