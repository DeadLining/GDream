import asyncio
import subprocess
from collections.abc import Callable
from contextlib import asynccontextmanager
from datetime import datetime
from time import perf_counter
from typing import Any, Literal
from urllib.parse import quote, urlsplit

import httpx

from comic_studio.provider_channels import ProviderChannel
from comic_studio.providers.qwen_tts import QwenTTSProvider
from comic_studio.schemas import ProviderChannelTestRead, ProviderChannelUpdate


ProviderKind = Literal["llm", "image", "tts"]
CONNECT_TIMEOUT_SECONDS = 2
TOTAL_TIMEOUT_SECONDS = 8
SSH_TIMEOUT_MARGIN_SECONDS = 0.25


class ProviderTestError(ValueError):
    """A connection-test error whose message is safe to return."""


@asynccontextmanager
async def default_client_factory(*, base_url: str, timeout: httpx.Timeout):
    async with httpx.AsyncClient(
        base_url=base_url,
        timeout=timeout,
        follow_redirects=False,
    ) as client:
        yield client


def default_provider_factory(
    _kind: ProviderKind,
    _channel: ProviderChannel,
    client: httpx.AsyncClient,
) -> httpx.AsyncClient:
    return client


def default_tts_provider_factory(
    channel: ProviderChannel,
    client: httpx.AsyncClient,
    ssh_executor: Callable[[list[str], bytes], bytes] | None,
) -> QwenTTSProvider:
    return QwenTTSProvider(
        api_key=channel.api_key_value or "",
        model=channel.model,
        base_url=channel.base_url,
        client=client,
        ssh_host=channel.ssh_host,
        ssh_executor=ssh_executor,
    )


class ProviderChannelTestingService:
    def __init__(
        self,
        *,
        stored_channel: Callable[[ProviderKind], ProviderChannel],
        clock: Callable[[], Any] = perf_counter,
        provider_factory: Callable[
            [ProviderKind, ProviderChannel, Any], Any
        ] = default_provider_factory,
        tts_provider_factory: Callable[..., Any] = default_tts_provider_factory,
        client_factory: Callable[..., Any] = default_client_factory,
        ssh_executor: Callable[[list[str], bytes], bytes] | None = None,
        subprocess_runner: Callable[..., Any] = subprocess.run,
        ssh_timeout_margin_seconds: float = SSH_TIMEOUT_MARGIN_SECONDS,
        total_timeout_seconds: float = TOTAL_TIMEOUT_SECONDS,
    ):
        self._stored_channel = stored_channel
        self._clock = clock
        self._provider_factory = provider_factory
        self._tts_provider_factory = tts_provider_factory
        self._client_factory = client_factory
        self._ssh_executor = ssh_executor
        self._subprocess_runner = subprocess_runner
        self._ssh_timeout_margin_seconds = ssh_timeout_margin_seconds
        self._total_timeout_seconds = total_timeout_seconds

    async def test(
        self,
        kind: ProviderKind,
        candidate: ProviderChannel | ProviderChannelUpdate,
    ) -> ProviderChannelTestRead:
        started_at = self._clock()
        scope = self._initial_scope(kind)
        error: str | None = None
        status: Literal["ok", "failed"] = "ok"
        channel: ProviderChannel | None = None
        deadline = perf_counter() + self._total_timeout_seconds

        try:
            async with asyncio.timeout(self._total_timeout_seconds):
                channel = self.resolve_candidate(kind, candidate)
                self.validate_channel(kind, channel)
                timeout = httpx.Timeout(
                    self._total_timeout_seconds,
                    connect=min(
                        CONNECT_TIMEOUT_SECONDS,
                        self._total_timeout_seconds,
                    ),
                )
                async with self._client_factory(
                    base_url=channel.base_url,
                    timeout=timeout,
                ) as client:
                    if kind == "llm":
                        provider = self._provider_factory(kind, channel, client)
                        await self._test_llm(provider, channel)
                    elif kind == "image":
                        provider = self._provider_factory(kind, channel, client)
                        scope = await self._test_image(provider, channel)
                    else:
                        provider = self._tts_provider_factory(
                            channel,
                            client,
                            self._ssh_executor
                            or self._make_bounded_ssh_executor(deadline),
                        )
                        await self._test_tts(provider)
        except Exception as exc:
            status = "failed"
            scope = getattr(exc, "check_scope", scope)
            error = self._sanitize_error(exc)

        elapsed_ms = self._elapsed_ms(started_at, self._clock())
        response_channel = channel or candidate
        return ProviderChannelTestRead(
            status=status,
            model=response_channel.model,
            host=urlsplit(str(response_channel.base_url)).hostname or "",
            elapsed_ms=elapsed_ms,
            check_scope=scope,
            error=error,
        )

    def resolve_candidate(
        self,
        kind: ProviderKind,
        candidate: ProviderChannel | ProviderChannelUpdate,
    ) -> ProviderChannel:
        if isinstance(candidate, ProviderChannelUpdate):
            current = self._stored_channel(kind)
            replacement_key = candidate.api_key.get_secret_value()
            effective_key = (
                None
                if candidate.clear_api_key
                else replacement_key or current.api_key
            )
            return ProviderChannel(
                name=candidate.name,
                enabled=candidate.enabled,
                base_url=str(candidate.base_url),
                model=candidate.model,
                api_key=effective_key,
                ssh_host=(candidate.ssh_host or None) if kind == "tts" else None,
            )
        if candidate.api_key_value:
            return candidate
        stored = self._stored_channel(kind)
        if not stored.api_key_value:
            return candidate
        return candidate.model_copy(update={"api_key": stored.api_key})

    @staticmethod
    def validate_channel(kind: ProviderKind, channel: ProviderChannel) -> None:
        if not channel.enabled:
            raise ProviderTestError(f"{kind} provider channel is not enabled")
        if kind in {"llm", "image"} and not channel.api_key_value:
            raise ProviderTestError(
                f"Enabled {kind} channel requires an api_key"
            )

    @staticmethod
    async def _test_llm(provider: Any, channel: ProviderChannel) -> None:
        response = await provider.post(
            "v1/messages",
            headers={
                "x-api-key": channel.api_key_value or "",
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": channel.model,
                "max_tokens": 1,
                "temperature": 0,
                "messages": [{"role": "user", "content": "ping"}],
            },
        )
        response.raise_for_status()
        response.json()

    @staticmethod
    async def _test_image(
        provider: Any,
        channel: ProviderChannel,
    ) -> Literal["model", "endpoint"]:
        headers = {"Authorization": f"Bearer {channel.api_key_value or ''}"}
        response = await provider.get(
            f"v1/models/{quote(channel.model, safe='')}",
            headers=headers,
        )
        if response.status_code not in {404, 405}:
            response.raise_for_status()
            return "model"

        try:
            endpoint_response = await provider.get("", headers=headers)
            if endpoint_response.status_code >= 500:
                endpoint_response.raise_for_status()
        except Exception as error:
            error.check_scope = "endpoint"
            raise
        return "endpoint"

    @staticmethod
    async def _test_tts(provider: Any) -> None:
        content = await provider.synthesize(
            "测试",
            "Dylan",
            "Chinese",
            "",
        )
        if (
            len(content) < 12
            or content[:4] != b"RIFF"
            or content[8:12] != b"WAVE"
        ):
            raise ProviderTestError("TTS returned invalid WAV data")

    @staticmethod
    def _initial_scope(kind: ProviderKind) -> Literal["model", "endpoint", "audio"]:
        return "audio" if kind == "tts" else "model"

    @staticmethod
    def _sanitize_error(error: Exception) -> str:
        if isinstance(error, subprocess.TimeoutExpired):
            return "Connection timed out"
        if isinstance(error, TimeoutError):
            return "Connection timed out"
        if isinstance(error, httpx.HTTPStatusError):
            return f"Provider returned HTTP {error.response.status_code}"
        if isinstance(error, httpx.HTTPError):
            return f"Connection failed ({type(error).__name__})"
        if isinstance(error, ProviderTestError):
            return str(error)
        if isinstance(error, ValueError):
            return "Provider returned an invalid response"
        return f"Provider test failed ({type(error).__name__})"

    def _make_bounded_ssh_executor(
        self,
        deadline: float,
    ) -> Callable[[list[str], bytes], bytes]:
        def execute(command: list[str], payload: bytes) -> bytes:
            timeout = max(
                0.001,
                deadline - perf_counter() - self._ssh_timeout_margin_seconds,
            )
            result = self._subprocess_runner(
                command,
                input=payload,
                capture_output=True,
                check=True,
                timeout=timeout,
            )
            return result.stdout

        return execute

    @staticmethod
    def _elapsed_ms(started_at: Any, finished_at: Any) -> int:
        elapsed = finished_at - started_at
        if isinstance(elapsed, datetime):
            seconds = elapsed.timestamp()
        elif hasattr(elapsed, "total_seconds"):
            seconds = elapsed.total_seconds()
        else:
            seconds = float(elapsed)
        return max(0, round(seconds * 1000))
