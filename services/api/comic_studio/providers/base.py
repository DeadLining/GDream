from typing import Any, Protocol


class ProviderError(RuntimeError):
    """A sanitized error raised by an external model provider."""


class ProviderHTTPError(ProviderError):
    """A sanitized provider response that retains its HTTP status."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
