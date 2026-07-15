from __future__ import annotations

import ipaddress
import re
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from pydantic import SecretStr

from comic_studio.model_runtime.adapters import register_capability
from comic_studio.model_runtime.contracts import Capability
from comic_studio.providers.base import ProviderError, ProviderHTTPError
from comic_studio.providers.model_3d_base import Model3DResult


_SAFE_MODEL_ID = re.compile(r"[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)+")
_SUPPORTED_IMAGES = {"image/png", "image/jpeg", "image/webp"}


class FalTripoSRProvider:
    provider_id = "fal-triposr"
    storage_base_url = "https://rest.fal.ai"
    max_model_bytes = 50 * 1024 * 1024

    def __init__(
        self,
        api_key: str | None = None,
        *,
        model: str = "fal-ai/triposr",
        base_url: str = "https://fal.run",
        client: httpx.AsyncClient | None = None,
    ):
        if not _SAFE_MODEL_ID.fullmatch(model) or ".." in model.split("/"):
            raise ValueError("Invalid fal model id")
        if urlsplit(base_url).scheme != "https":
            raise ValueError("fal Base URL must use HTTPS")
        self._api_key = SecretStr((api_key or "").strip())
        self.model = model
        self.base_url = base_url.rstrip("/")
        self._client = client

    @classmethod
    def supports_channel(cls, channel) -> bool:
        return str(channel.model).casefold().startswith("fal-ai/triposr")

    @classmethod
    def from_channel(cls, channel, **_kwargs):
        return cls(
            channel.api_key_value,
            model=channel.model,
            base_url=channel.base_url,
        )

    def _headers(self) -> dict[str, str]:
        key = self._api_key.get_secret_value()
        if not key:
            raise ProviderError("fal 3D provider is not configured")
        return {"Authorization": f"Key {key}"}

    async def check_health(self) -> None:
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(timeout=httpx.Timeout(15, connect=3))
        try:
            response = await client.post(
                f"{self.storage_base_url}/storage/auth/token",
                params={"storage_type": "fal-cdn-v3"},
                headers={**self._headers(), "Accept": "application/json"},
                json={},
            )
            self._raise_for_status(response, "health check")
            payload = response.json()
            if not isinstance(payload, dict) or not payload.get("token"):
                raise ProviderError("fal 3D health check returned invalid data")
        except (ValueError, TypeError) as exc:
            raise ProviderError("fal 3D health check returned invalid data") from exc
        finally:
            if owns_client:
                await client.aclose()

    async def generate_model(
        self,
        image_bytes: bytes,
        image_media_type: str,
        filename: str,
    ) -> Model3DResult:
        if not image_bytes or image_media_type not in _SUPPORTED_IMAGES:
            raise ProviderError("fal 3D reference image is invalid")
        safe_name = Path(filename).name[:160] or "reference.png"
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(
            timeout=httpx.Timeout(240, connect=5),
            follow_redirects=False,
        )
        try:
            image_url = await self._upload_reference(
                client, image_bytes, image_media_type, safe_name
            )
            response = await client.post(
                f"{self.base_url}/{self.model}",
                headers={**self._headers(), "Content-Type": "application/json"},
                json={
                    "image_url": image_url,
                    "output_format": "glb",
                    "do_remove_background": True,
                    "foreground_ratio": 0.9,
                    "mc_resolution": 256,
                },
            )
            self._raise_for_status(response, "generation")
            model_url = self._model_url(response)
            content = bytearray()
            async with client.stream("GET", model_url) as download:
                self._raise_for_status(download, "download")
                content_length = int(
                    download.headers.get("content-length", "0") or 0
                )
                if content_length > self.max_model_bytes:
                    raise ProviderError("fal 3D model is too large")
                async for chunk in download.aiter_bytes():
                    if len(content) + len(chunk) > self.max_model_bytes:
                        raise ProviderError("fal 3D model is too large")
                    content.extend(chunk)
            if not content:
                raise ProviderError("fal 3D returned an empty model")
            return Model3DResult(bytes(content), model_url)
        except httpx.TimeoutException as exc:
            raise TimeoutError("fal 3D request timed out") from exc
        except httpx.TransportError as exc:
            raise ProviderError("fal 3D request failed") from exc
        finally:
            if owns_client:
                await client.aclose()

    async def _upload_reference(
        self,
        client: httpx.AsyncClient,
        content: bytes,
        media_type: str,
        filename: str,
    ) -> str:
        response = await client.post(
            f"{self.storage_base_url}/storage/upload/initiate",
            params={"storage_type": "gcs"},
            headers={
                **self._headers(),
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json={"file_name": filename, "content_type": media_type},
        )
        self._raise_for_status(response, "upload initialization")
        try:
            payload = response.json()
            upload_url = str(payload["upload_url"])
            file_url = str(payload["file_url"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderError("fal 3D returned an invalid upload response") from exc
        self._validate_upload_url(upload_url)
        self._validate_fal_media_url(file_url, "upload")
        uploaded = await client.put(
            upload_url,
            content=content,
            headers={"Content-Type": media_type},
        )
        self._raise_for_status(uploaded, "upload")
        return file_url

    @classmethod
    def _model_url(cls, response: httpx.Response) -> str:
        try:
            payload = response.json()
            model_url = str(payload["model_mesh"]["url"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderError("fal 3D returned invalid generation data") from exc
        cls._validate_fal_media_url(model_url, "model")
        return model_url

    @classmethod
    def _validate_upload_url(cls, value: str) -> None:
        cls._validate_https_url(value, "upload")
        host = (urlsplit(value).hostname or "").casefold()
        trusted = (
            host == "storage.googleapis.com"
            or host.endswith(".storage.googleapis.com")
            or host == "fal.media"
            or host.endswith(".fal.media")
        )
        if not trusted:
            raise ProviderError("fal 3D returned an untrusted upload URL")

    @classmethod
    def _validate_fal_media_url(cls, value: str, label: str) -> None:
        cls._validate_https_url(value, label)
        host = (urlsplit(value).hostname or "").casefold()
        if host != "fal.media" and not host.endswith(".fal.media"):
            raise ProviderError(f"fal 3D returned an untrusted {label} URL")

    @staticmethod
    def _validate_https_url(value: str, label: str) -> None:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        if parsed.scheme != "https" or not host or parsed.username or parsed.password:
            raise ProviderError(f"fal 3D returned an invalid {label} response")
        if host.casefold() == "localhost" or host.casefold().endswith(".localhost"):
            raise ProviderError(f"fal 3D returned an invalid {label} response")
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            return
        if not address.is_global:
            raise ProviderError(f"fal 3D returned an invalid {label} response")

    @staticmethod
    def _raise_for_status(response: httpx.Response, operation: str) -> None:
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise ProviderHTTPError(
                exc.response.status_code,
                f"fal 3D {operation} failed",
            ) from exc


PROVIDER_CAPABILITY = register_capability(
    Capability.MODEL_3D,
    provider_class="FalTripoSRProvider",
)
