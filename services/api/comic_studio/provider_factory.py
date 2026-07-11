from collections.abc import Callable
from typing import Any

from comic_studio.provider_channels import ProviderChannelStore
from comic_studio.providers.gpt_image import GPTImageProvider
from comic_studio.providers.minimax import MiniMaxProvider
from comic_studio.providers.qwen_tts import QwenTTSProvider


class ProviderConfigurationError(RuntimeError):
    """A stable, sanitized error for unavailable provider channels."""


class ProviderFactory:
    def __init__(
        self,
        store: ProviderChannelStore,
        *,
        llm_provider_class: Callable[..., Any] = MiniMaxProvider,
        image_provider_class: Callable[..., Any] = GPTImageProvider,
        tts_provider_class: Callable[..., Any] = QwenTTSProvider,
    ):
        self._store = store
        self._llm_provider_class = llm_provider_class
        self._image_provider_class = image_provider_class
        self._tts_provider_class = tts_provider_class

    def create_llm(self) -> MiniMaxProvider:
        channel = self._store.snapshot.llm
        self._require_configured(
            "llm",
            channel,
            require_api_key=True,
        )
        return self._llm_provider_class(
            channel.api_key_value,
            model=channel.model,
            base_url=channel.base_url,
        )

    def create_image(self) -> GPTImageProvider:
        channel = self._store.snapshot.image
        self._require_configured(
            "image",
            channel,
            require_api_key=True,
        )
        return self._image_provider_class(
            channel.api_key_value,
            model=channel.model,
            base_url=channel.base_url,
        )

    def create_tts(self) -> QwenTTSProvider:
        channel = self._store.snapshot.tts
        self._require_configured("tts", channel)
        return self._tts_provider_class(
            api_key=channel.api_key_value or "",
            model=channel.model,
            base_url=channel.base_url,
            ssh_host=channel.ssh_host,
        )

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
