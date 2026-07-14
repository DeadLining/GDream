from dataclasses import dataclass
from enum import StrEnum

import httpx

from comic_studio.model_runtime.contracts import Capability
from comic_studio.provider_factory import ProviderConfigurationError
from comic_studio.providers.base import ProviderError, ProviderHTTPError


class RuntimeErrorCode(StrEnum):
    CONFIGURATION_ERROR = "configuration_error"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    PROVIDER_TIMEOUT = "provider_timeout"
    INVALID_RESPONSE = "invalid_response"
    RUNTIME_INTERRUPTED = "runtime_interrupted"


@dataclass(frozen=True)
class ModelRuntimeError(Exception):
    code: RuntimeErrorCode
    message: str
    retryable: bool
    capability: Capability
    provider: str = ""


def classify_provider_error(
    error: Exception, capability: Capability, provider: str = ""
) -> ModelRuntimeError:
    label = capability.value
    if isinstance(error, ProviderConfigurationError):
        return ModelRuntimeError(
            RuntimeErrorCode.CONFIGURATION_ERROR,
            f"{label} capability is not configured",
            False,
            capability,
            provider,
        )
    if isinstance(error, (TimeoutError, httpx.TimeoutException)):
        return ModelRuntimeError(
            RuntimeErrorCode.PROVIDER_TIMEOUT,
            f"{label} provider timed out",
            True,
            capability,
            provider,
        )
    if isinstance(error, (httpx.TransportError, ConnectionError, OSError)):
        return ModelRuntimeError(
            RuntimeErrorCode.PROVIDER_UNAVAILABLE,
            f"{label} provider is unavailable",
            True,
            capability,
            provider,
        )
    if isinstance(error, ProviderHTTPError):
        if error.status_code in {408, 504}:
            return ModelRuntimeError(
                RuntimeErrorCode.PROVIDER_TIMEOUT,
                f"{label} provider timed out",
                True,
                capability,
                provider,
            )
        if error.status_code == 429 or error.status_code >= 500:
            return ModelRuntimeError(
                RuntimeErrorCode.PROVIDER_UNAVAILABLE,
                f"{label} provider is unavailable",
                True,
                capability,
                provider,
            )
        return ModelRuntimeError(
            RuntimeErrorCode.INVALID_RESPONSE,
            f"{label} provider rejected the request",
            False,
            capability,
            provider,
        )
    if isinstance(error, ProviderError):
        return ModelRuntimeError(
            RuntimeErrorCode.INVALID_RESPONSE,
            f"{label} provider returned an invalid response",
            False,
            capability,
            provider,
        )
    return ModelRuntimeError(
        RuntimeErrorCode.PROVIDER_UNAVAILABLE,
        f"{label} invocation failed",
        True,
        capability,
        provider,
    )
