import base64
from dataclasses import dataclass

import httpx

from comic_studio.providers.base import ProviderError


@dataclass(frozen=True)
class ImageResult:
    content: bytes
    media_type: str = "image/png"


class GPTImageProvider:
    def __init__(
        self,
        api_key: str,
        *,
        model: str = "gpt-image-2",
        base_url: str = "http://192.168.18.80:14000",
        client: httpx.AsyncClient | None = None,
    ):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self._client = client

    async def generate(
        self,
        prompt: str,
        size: str = "1024x1536",
        quality: str = "auto",
    ) -> ImageResult:
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(base_url=self.base_url, timeout=600)
        try:
            response = await client.post(
                "/v1/images/generations",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "size": size,
                    "quality": quality,
                    "n": 1,
                },
            )
            response.raise_for_status()
            item = response.json().get("data", [{}])[0]
            if item.get("b64_json"):
                return ImageResult(base64.b64decode(item["b64_json"]))
            if item.get("url"):
                download = await client.get(item["url"], timeout=120)
                download.raise_for_status()
                return ImageResult(
                    download.content, download.headers.get("content-type", "image/png")
                )
            raise ProviderError("GPT Image returned no image data")
        except httpx.HTTPError as exc:
            raise ProviderError(
                f"GPT Image request failed: {type(exc).__name__}"
            ) from exc
        finally:
            if owns_client:
                await client.aclose()

    async def edit(
        self,
        prompt: str,
        references: list[tuple[bytes, str]],
        size: str = "1024x1536",
        quality: str = "auto",
    ) -> ImageResult:
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(base_url=self.base_url, timeout=600)
        files = [
            ("image[]", (f"reference-{index}", content, media_type))
            for index, (content, media_type) in enumerate(references, start=1)
        ]
        try:
            response = await client.post(
                "/v1/images/edits",
                headers={"Authorization": f"Bearer {self.api_key}"},
                data={
                    "model": self.model,
                    "prompt": prompt,
                    "size": size,
                    "quality": quality,
                    "n": "1",
                },
                files=files,
            )
            response.raise_for_status()
            item = response.json().get("data", [{}])[0]
            if item.get("b64_json"):
                return ImageResult(base64.b64decode(item["b64_json"]))
            if item.get("url"):
                download = await client.get(item["url"], timeout=120)
                download.raise_for_status()
                return ImageResult(
                    download.content, download.headers.get("content-type", "image/png")
                )
            raise ProviderError("GPT Image returned no image data")
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in {404, 405, 501}:
                raise ProviderError("reference_edit_unsupported") from exc
            raise ProviderError(
                f"GPT Image edit failed: HTTP {exc.response.status_code}"
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"GPT Image edit failed: {type(exc).__name__}") from exc
        finally:
            if owns_client:
                await client.aclose()
