import httpx

from comic_studio.providers.base import ProviderError


class QwenTTSProvider:
    def __init__(
        self,
        *,
        base_url: str = "http://192.168.18.94:18080",
        model: str = "Qwen3-TTS-12Hz-1.7B-CustomVoice",
        client: httpx.AsyncClient | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self._client = client

    async def synthesize(
        self,
        text: str,
        speaker: str,
        language: str = "Chinese",
        instruction: str = "",
    ) -> bytes:
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(base_url=self.base_url, timeout=180)
        try:
            response = await client.post(
                "/v1/audio/speech",
                json={
                    "model": self.model,
                    "text": text,
                    "speaker": speaker,
                    "language": language,
                    "instruct": instruction,
                    "response_format": "wav",
                },
            )
            response.raise_for_status()
            if "audio/wav" not in response.headers.get("content-type", ""):
                raise ProviderError("Qwen TTS returned a non-WAV response")
            if not response.content.startswith(b"RIFF"):
                raise ProviderError("Qwen TTS returned invalid WAV data")
            return response.content
        except httpx.HTTPError as exc:
            raise ProviderError(f"Qwen TTS request failed: {type(exc).__name__}") from exc
        finally:
            if owns_client:
                await client.aclose()
