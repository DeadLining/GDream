from collections.abc import Callable
from typing import Any

from comic_studio.model_runtime.adapters import (
    CapabilityAdapterRegistry,  # re-exported for backwards-compat imports
    ProviderRegistry,
)
from comic_studio.model_runtime.contracts import Capability
from comic_studio.provider_channels import ProviderChannelStore

__all__ = ["CapabilityAdapterRegistry", "ProviderFactory"]


class ProviderConfigurationError(RuntimeError):
    """A stable, sanitized error for unavailable provider channels."""


# Module-level default registry, lazily discovered from ``comic_studio.providers``.
# Tests can swap this via ``ProviderFactory(registry=...)`` without mutating global state.
_DEFAULT_REGISTRY: ProviderRegistry | None = None


def _load_default_registry() -> ProviderRegistry:
    global _DEFAULT_REGISTRY
    if _DEFAULT_REGISTRY is None:
        _DEFAULT_REGISTRY = ProviderRegistry.discover_default()
    return _DEFAULT_REGISTRY


def reset_default_registry() -> None:
    """Test helper: forget the cached default registry (next call re-discovers)."""
    global _DEFAULT_REGISTRY
    _DEFAULT_REGISTRY = None


# Maps each factory method to the capability it serves.
_CAPABILITY_FOR_METHOD: dict[str, Capability] = {
    "llm": Capability.TEXT,
    "image": Capability.IMAGE,
    "tts": Capability.SPEECH,
    "video": Capability.VIDEO,
}


class ProviderFactory:
    """Builds provider instances from the current channel snapshot.

    Resolution order for each capability (highest first):

    1. An explicit ``xxx_provider_class=`` constructor argument (test injection).
    2. An override registered on the supplied :class:`ProviderRegistry`.
    3. A provider auto-discovered by scanning ``comic_studio.providers``.

    New providers no longer require editing this file — drop a module exposing
    ``PROVIDER_CAPABILITY`` and a ``from_channel`` classmethod into
    ``comic_studio/providers/`` and it is picked up automatically.
    """

    def __init__(
        self,
        store: ProviderChannelStore,
        *,
        llm_provider_class: Callable[..., Any] | None = None,
        image_provider_class: Callable[..., Any] | None = None,
        tts_provider_class: Callable[..., Any] | None = None,
        video_provider_class: Callable[..., Any] | None = None,
        prefer_ssh_for_host: Callable[[str], bool] | None = None,
        registry: ProviderRegistry | None = None,
    ):
        self._store = store
        self._prefer_ssh_for_host = prefer_ssh_for_host
        self._registry = registry or _load_default_registry()
        # Exposed as instance attributes so legacy callers/tests that swap them at
        # runtime (``factory._llm_provider_class = FakeLLM``) keep working.
        self._llm_provider_class = llm_provider_class
        self._image_provider_class = image_provider_class
        self._tts_provider_class = tts_provider_class
        self._video_provider_class = video_provider_class

    @property
    def _explicit_overrides(self) -> dict[Capability, Callable[..., Any]]:
        return {
            capability: provider_class
            for kind, capability in _CAPABILITY_FOR_METHOD.items()
            if (provider_class := getattr(self, f"_{kind}_provider_class")) is not None
        }

    def create_llm(self) -> Any:
        return self._build("llm", self._store.snapshot.llm)

    def create_image(self) -> Any:
        return self._build("image", self._store.snapshot.image)

    def create_tts(self) -> Any:
        return self._build("tts", self._store.snapshot.tts)

    def create_video(self) -> Any:
        return self._build("video", self._store.snapshot.video)

    def _build(self, kind: str, channel: Any) -> Any:
        capability = _CAPABILITY_FOR_METHOD[kind]
        self._require_configured(kind, channel, require_api_key=self._requires_api_key(kind))
        provider_class = self._resolve_provider_class(capability, channel)
        # Provider classes registered through the registry expose ``from_channel``;
        # legacy test doubles injected via ``xxx_provider_class=`` still use the
        # positional constructor, so fall back when the classmethod is absent.
        from_channel = getattr(provider_class, "from_channel", None)
        if callable(from_channel):
            return from_channel(
                channel,
                prefer_ssh_for_host=self._prefer_ssh_for_host,
            )
        return self._legacy_construct(kind, provider_class, channel)

    def _legacy_construct(self, kind: str, provider_class: Callable[..., Any], channel: Any) -> Any:
        """Backwards-compatible positional construction for legacy test doubles."""
        api_key = channel.api_key_value
        if kind == "tts":
            return provider_class(
                api_key=api_key or "",
                model=channel.model,
                base_url=channel.base_url,
                ssh_host=channel.ssh_host,
                prefer_ssh=self._should_prefer_ssh(channel.ssh_host),
            )
        return provider_class(
            api_key,
            model=channel.model,
            base_url=channel.base_url,
        )

    def _resolve_provider_class(
        self,
        capability: Capability,
        channel: Any | None = None,
    ) -> Callable[..., Any]:
        if capability in self._explicit_overrides:
            return self._explicit_overrides[capability]
        if channel is not None:
            for registration in self._registry.registrations():
                if registration.capability is not capability:
                    continue
                supports_channel = getattr(
                    registration.provider_class,
                    "supports_channel",
                    None,
                )
                if callable(supports_channel) and supports_channel(channel):
                    return registration.provider_class
        return self._registry.get(capability)

    def _should_prefer_ssh(self, ssh_host: str | None) -> bool:
        if not ssh_host or self._prefer_ssh_for_host is None:
            return False
        try:
            return bool(self._prefer_ssh_for_host(ssh_host))
        except Exception:
            return False

    @staticmethod
    def _requires_api_key(kind: str) -> bool:
        # Local speech and video services may be directly reachable without auth.
        return kind in {"llm", "image"}

    @staticmethod
    def _require_configured(
        kind: str,
        channel: Any,
        *,
        require_api_key: bool = False,
    ) -> None:
        configured = (
            channel.enabled
            and bool(channel.name)
            and bool(channel.base_url)
            and bool(channel.model)
            and (not require_api_key or bool(channel.api_key_value))
        )
        if not configured:
            raise ProviderConfigurationError(
                f"{kind} provider channel is not configured"
            )
