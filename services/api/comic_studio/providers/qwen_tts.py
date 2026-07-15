import asyncio
import base64
import json
import subprocess
from collections.abc import Callable

import httpx
from pydantic import SecretStr

from comic_studio.providers.base import ProviderError


class QwenTTSProvider:
    SUPPORTED_SPEAKERS = frozenset(
        {
            "aiden",
            "dylan",
            "eric",
            "ono_anna",
            "ryan",
            "serena",
            "sohee",
            "uncle_fu",
            "vivian",
        }
    )
    FEMALE_VOICE_HINTS = ("female", "woman", "girl", "女性", "女声", "少女", "女孩")
    OLDER_MALE_VOICE_HINTS = ("older male", "old man", "elder", "大叔", "老年", "年长", "老人")

    def __init__(
        self,
        *,
        base_url: str = "http://192.168.18.94:18080",
        model: str = "Qwen3-TTS-12Hz-1.7B-CustomVoice",
        api_key: str = "",
        client: httpx.AsyncClient | None = None,
        ssh_host: str | None = None,
        ssh_executor: Callable[[list[str], bytes], bytes] | None = None,
        prefer_ssh: bool = False,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self._api_key = SecretStr(api_key.strip())
        self._client = client
        self.ssh_host = ssh_host
        self.ssh_executor = ssh_executor or self._default_ssh_executor
        self.prefer_ssh = prefer_ssh

    @classmethod
    def from_channel(cls, channel, *, prefer_ssh_for_host=None, **_kwargs):
        """Build an instance from a :class:`ProviderChannel`.

        ``prefer_ssh_for_host`` is consulted only when the channel actually has
        an ``ssh_host``; any predicate error fails closed (``prefer_ssh=False``).
        """
        ssh_host = channel.ssh_host
        prefer_ssh = cls._evaluate_prefer_ssh(ssh_host, prefer_ssh_for_host)
        return cls(
            api_key=channel.api_key_value or "",
            model=channel.model,
            base_url=channel.base_url,
            ssh_host=ssh_host,
            prefer_ssh=prefer_ssh,
        )

    @staticmethod
    def _evaluate_prefer_ssh(ssh_host, prefer_ssh_for_host) -> bool:
        if not ssh_host or prefer_ssh_for_host is None:
            return False
        try:
            return bool(prefer_ssh_for_host(ssh_host))
        except Exception:
            return False


    async def check_health(self) -> None:
        if self.prefer_ssh and self.ssh_host:
            await asyncio.to_thread(self._check_health_via_ssh)
            return

        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(10, connect=3),
        )
        try:
            response = await client.get("/health")
            response.raise_for_status()
            self._validate_health(response.content)
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            if self.ssh_host:
                await asyncio.to_thread(self._check_health_via_ssh)
                return
            raise ProviderError("Qwen TTS health check failed") from exc
        finally:
            if owns_client:
                await client.aclose()

    async def synthesize(
        self,
        text: str,
        speaker: str,
        language: str = "Chinese",
        instruction: str = "",
    ) -> bytes:
        payload = {
            "model": self.model,
            "text": text,
            "speaker": self.resolve_speaker(speaker),
            "language": language,
            "instruct": instruction,
            "response_format": "wav",
        }
        if self.prefer_ssh and self.ssh_host:
            audio = await asyncio.to_thread(self._synthesize_via_ssh, payload)
            return self._validate_wav(audio)

        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(180, connect=3),
        )
        try:
            headers = self._authorization_headers()
            response = await client.post(
                "/v1/audio/speech",
                headers=headers or None,
                json=payload,
            )
            response.raise_for_status()
            if "audio/wav" not in response.headers.get("content-type", ""):
                raise ProviderError("Qwen TTS returned a non-WAV response")
            return self._validate_wav(response.content)
        except httpx.TransportError as exc:
            if self.ssh_host:
                audio = await asyncio.to_thread(self._synthesize_via_ssh, payload)
                return self._validate_wav(audio)
            raise ProviderError(f"Qwen TTS request failed: {type(exc).__name__}") from exc
        except httpx.HTTPStatusError as exc:
            if self.ssh_host and exc.response.status_code in {502, 503, 504}:
                audio = await asyncio.to_thread(self._synthesize_via_ssh, payload)
                return self._validate_wav(audio)
            raise ProviderError(
                f"Qwen TTS request failed with HTTP {exc.response.status_code}"
            ) from exc
        finally:
            if owns_client:
                await client.aclose()

    @classmethod
    def resolve_speaker(cls, speaker: str) -> str:
        normalized = speaker.strip().lower().replace("-", "_").replace(" ", "_")
        if normalized in cls.SUPPORTED_SPEAKERS:
            return normalized

        hint = speaker.strip().lower()
        if any(marker in hint for marker in cls.FEMALE_VOICE_HINTS):
            return "vivian"
        if any(marker in hint for marker in cls.OLDER_MALE_VOICE_HINTS):
            return "uncle_fu"
        return "dylan"

    def _synthesize_via_ssh(self, payload: dict) -> bytes:
        config_lines = [
            'url = "http://127.0.0.1:18080/v1/audio/speech"',
            'header = "content-type: application/json"',
        ]
        if api_key := self._api_key.get_secret_value():
            authorization = self._escape_curl_config(
                f"Authorization: Bearer {api_key}"
            )
            config_lines.append(f'header = "{authorization}"')
        payload_json = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        config_lines.append(
            f'data = "{self._escape_curl_config(payload_json)}"'
        )
        config_payload = ("\n".join(config_lines) + "\n").encode("utf-8")
        remote_command = (
            "set -o pipefail; "
            "curl -fsS --max-time 180 --config - | base64 -w 0"
        )
        try:
            encoded = self.ssh_executor(
                ["ssh", self.ssh_host or "", remote_command],
                config_payload,
            )
        except subprocess.TimeoutExpired:
            raise TimeoutError("Qwen TTS SSH fallback timed out") from None
        except Exception:
            raise ProviderError("Qwen TTS SSH fallback failed") from None
        try:
            return base64.b64decode(encoded.strip(), validate=True)
        except ValueError as exc:
            raise ProviderError("Qwen TTS SSH fallback returned invalid Base64") from exc

    def _check_health_via_ssh(self) -> None:
        try:
            content = self.ssh_executor(
                [
                    "ssh",
                    self.ssh_host or "",
                    "curl -fsS --max-time 10 http://127.0.0.1:18080/health",
                ],
                b"",
            )
        except (TimeoutError, subprocess.TimeoutExpired):
            raise
        except Exception:
            raise ProviderError("Qwen TTS SSH health check failed") from None
        self._validate_health(content)

    def _authorization_headers(self) -> dict[str, str]:
        api_key = self._api_key.get_secret_value()
        return {"Authorization": f"Bearer {api_key}"} if api_key else {}

    @staticmethod
    def _escape_curl_config(value: str) -> str:
        return (
            value.replace("\\", "\\\\")
            .replace('"', '\\"')
            .replace("\t", "\\t")
            .replace("\r", "\\r")
            .replace("\n", "\\n")
        )

    @staticmethod
    def _default_ssh_executor(command: list[str], payload: bytes) -> bytes:
        result = subprocess.run(
            command,
            input=payload,
            capture_output=True,
            check=True,
            timeout=240,
        )
        return result.stdout

    @staticmethod
    def _validate_wav(content: bytes) -> bytes:
        if not content.startswith(b"RIFF"):
            raise ProviderError("Qwen TTS returned invalid WAV data")
        return content

    @staticmethod
    def _validate_health(content: bytes) -> None:
        try:
            payload = json.loads(content)
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError):
            raise ProviderError("Qwen TTS returned invalid health data") from None
        if not isinstance(payload, dict) or payload.get("status") != "ok":
            raise ProviderError("Qwen TTS health check failed")


from comic_studio.model_runtime.adapters import register_capability
from comic_studio.model_runtime.contracts import Capability

PROVIDER_CAPABILITY = register_capability(Capability.SPEECH, provider_class="QwenTTSProvider")
