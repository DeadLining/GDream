from typing import Any, Protocol


class DirectorSuggestionProvider(Protocol):
    async def suggest_director(self, context: dict[str, Any]): ...


class ProviderError(RuntimeError):
    """A sanitized error raised by an external model provider."""
