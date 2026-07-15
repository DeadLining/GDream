import base64
from dataclasses import dataclass
from io import BytesIO

import httpx
from PIL import Image, UnidentifiedImageError

from comic_studio.providers.base import ProviderError, ProviderHTTPError
from comic_studio.redaction import redact


@dataclass(frozen=True)
class ImageResult:
    content: bytes
    media_type: str = "image/png"


def prepare_edit_reference(
    content: bytes, media_type: str, *, max_dimension: int = 256
) -> tuple[bytes, str]:
    try:
        with Image.open(BytesIO(content)) as image:
            image.load()
            if max(image.size) <= max_dimension:
                return content, media_type
            image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
            output = BytesIO()
            image.convert("RGB").save(output, format="JPEG", quality=88, optimize=True)
            return output.getvalue(), "image/jpeg"
    except (UnidentifiedImageError, OSError, ValueError):
        return content, media_type


def _response_error(response: httpx.Response) -> str:
    detail = "request failed"
    try:
        payload = response.json()
        error = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(error, dict):
            detail = str(error.get("message") or error.get("detail") or detail)
        elif error:
            detail = str(error)
        elif isinstance(payload, dict) and payload.get("detail"):
            detail = str(payload["detail"])
    except (ValueError, TypeError):
        pass
    return str(redact(detail)).strip()[:500] or "request failed"


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

    @classmethod
    def from_channel(cls, channel, *, prefer_ssh_for_host=None, **_kwargs):
        """Build an instance from a :class:`ProviderChannel`."""
        return cls(
            channel.api_key_value,
            model=channel.model,
            base_url=channel.base_url,
        )

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
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            raise ProviderHTTPError(
                status,
                f"GPT Image HTTP {status}: {_response_error(exc.response)}",
            ) from exc
        except httpx.TimeoutException as exc:
            raise TimeoutError("GPT Image request timed out") from exc
        except httpx.TransportError as exc:
            raise ConnectionError("GPT Image provider is unavailable") from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"GPT Image request failed: {type(exc).__name__}") from exc
        finally:
            if owns_client:
                await client.aclose()

    async def edit(
        self,
        prompt: str,
        references: list[tuple[bytes, str] | tuple[bytes, str, int]],
        size: str = "1024x1536",
        quality: str = "low",
    ) -> ImageResult:
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(base_url=self.base_url, timeout=600)
        prepared = [
            prepare_edit_reference(
                reference[0],
                reference[1],
                max_dimension=reference[2] if len(reference) == 3 else 256,
            )
            for reference in references
        ]
        files = [
            ("image[]", (f"reference-{index}", content, media_type))
            for index, (content, media_type) in enumerate(prepared, start=1)
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
            status = exc.response.status_code
            raise ProviderHTTPError(
                status,
                f"GPT Image HTTP {status}: {_response_error(exc.response)}",
            ) from exc
        except httpx.TimeoutException as exc:
            raise TimeoutError("GPT Image edit timed out") from exc
        except httpx.TransportError as exc:
            raise ConnectionError("GPT Image provider is unavailable") from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"GPT Image edit failed: {type(exc).__name__}") from exc
        finally:
            if owns_client:
                await client.aclose()


from comic_studio.model_runtime.adapters import register_capability
from comic_studio.model_runtime.contracts import Capability

PROVIDER_CAPABILITY = register_capability(Capability.IMAGE, provider_class="GPTImageProvider")
