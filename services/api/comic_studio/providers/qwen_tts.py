import asyncio
import base64
import json
import subprocess
from collections.abc import Callable

import httpx
from pydantic import SecretStr

from comic_studio.providers.base import ProviderError


class QwenTTSProvider:
    def __init__(
        self,
        *,
        base_url: str = "http://192.168.18.94:18080",
        model: str = "Qwen3-TTS-12Hz-1.7B-CustomVoice",
        api_key: str = "",
        client: httpx.AsyncClient | None = None,
        ssh_host: str | None = None,
        ssh_executor: Callable[[list[str], bytes], bytes] | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self._api_key = SecretStr(api_key.strip())
        self._client = client
        self.ssh_host = ssh_host
        self.ssh_executor = ssh_executor or self._default_ssh_executor

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
            "speaker": speaker,
            "language": language,
            "instruct": instruction,
            "response_format": "wav",
        }
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
