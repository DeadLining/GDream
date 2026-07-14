from comic_studio.model_runtime.contracts import Capability, RuntimeJobRead
from comic_studio.model_runtime.errors import RuntimeErrorCode, classify_provider_error
from comic_studio.providers.base import ProviderError, ProviderHTTPError


def test_runtime_job_contract_uses_capability_names():
    result = RuntimeJobRead(
        job_id="job-1", capability=Capability.IMAGE, status="queued"
    )

    assert result.model_dump(mode="json") == {
        "job_id": "job-1",
        "capability": "image",
        "status": "queued",
    }


def test_provider_timeout_is_retryable_and_sanitized():
    error = classify_provider_error(
        TimeoutError("secret request payload"), Capability.IMAGE
    )

    assert error.code is RuntimeErrorCode.PROVIDER_TIMEOUT
    assert error.retryable is True
    assert "secret request payload" not in error.message


def test_invalid_provider_response_is_not_reported_as_connectivity():
    error = classify_provider_error(
        ProviderError("GPT Image returned no image data"), Capability.IMAGE
    )

    assert error.code is RuntimeErrorCode.INVALID_RESPONSE


def test_transient_provider_http_error_is_retryable():
    error = classify_provider_error(
        ProviderHTTPError(503, "GPT Image HTTP 503: workers busy"),
        Capability.IMAGE,
    )

    assert error.code is RuntimeErrorCode.PROVIDER_UNAVAILABLE
    assert error.retryable is True
