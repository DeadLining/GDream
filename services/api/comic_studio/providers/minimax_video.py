from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Literal

import httpx

from comic_studio.providers.base import ProviderError


@dataclass(frozen=True)
class VideoTask:
    id: str
    status: Literal["queued", "processing", "succeeded", "failed"]
    file_id: str | None = None
    error: str = ""


@dataclass(frozen=True)
class VideoResult:
    content: bytes
    media_type: str = "video/mp4"


class MiniMaxVideoProvider:
    def __init__(
        self,
        api_key: str,
        *,
        model: str = "MiniMax-Hailuo-02",
        base_url: str = "https://api.minimaxi.com",
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

    def _headers(self):
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def submit_image_to_video(
        self, prompt: str, image_bytes: bytes, image_media_type: str, duration: float
    ) -> str:
        owns = self._client is None
        client = self._client or httpx.AsyncClient(base_url=self.base_url, timeout=120)
        try:
            image = f"data:{image_media_type};base64,{base64.b64encode(image_bytes).decode()}"
            response = await client.post(
                "/v1/video_generation",
                headers=self._headers(),
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "first_frame_image": image,
                    "duration": round(duration),
                },
            )
            response.raise_for_status()
            task_id = response.json().get("task_id")
            if not task_id:
                raise ProviderError("MiniMax video returned no task id")
            return str(task_id)
        except httpx.HTTPError as exc:
            raise ProviderError(
                f"MiniMax video submit failed: {type(exc).__name__}"
            ) from exc
        finally:
            if owns:
                await client.aclose()

    async def get_task(self, task_id: str) -> VideoTask:
        owns = self._client is None
        client = self._client or httpx.AsyncClient(base_url=self.base_url, timeout=30)
        try:
            response = await client.get(
                "/v1/query/video_generation",
                headers=self._headers(),
                params={"task_id": task_id},
            )
            response.raise_for_status()
            payload = response.json()
            raw = str(payload.get("status", "")).casefold()
            status = (
                "succeeded"
                if raw in {"success", "succeeded"}
                else "failed"
                if raw in {"fail", "failed"}
                else "processing"
                if raw in {"processing", "running"}
                else "queued"
            )
            return VideoTask(
                task_id,
                status,
                payload.get("file_id"),
                "video_task_failed" if status == "failed" else "",
            )
        except httpx.HTTPError as exc:
            raise ProviderError(
                f"MiniMax video query failed: {type(exc).__name__}"
            ) from exc
        finally:
            if owns:
                await client.aclose()

    async def download_result(self, task: VideoTask) -> VideoResult:
        if task.status != "succeeded" or not task.file_id:
            raise ProviderError("video_task_not_ready")
        owns = self._client is None
        client = self._client or httpx.AsyncClient(base_url=self.base_url, timeout=120)
        try:
            metadata = await client.get(
                "/v1/files/retrieve",
                headers=self._headers(),
                params={"file_id": task.file_id},
            )
            metadata.raise_for_status()
            url = (metadata.json().get("file") or {}).get(
                "download_url"
            ) or metadata.json().get("download_url")
            if not url:
                raise ProviderError("MiniMax video returned no download URL")
            response = await client.get(url)
            response.raise_for_status()
            content = response.content
            if b"ftyp" not in content[:32]:
                raise ProviderError("MiniMax video returned invalid MP4 data")
            return VideoResult(content)
        except httpx.HTTPError as exc:
            raise ProviderError(
                f"MiniMax video download failed: {type(exc).__name__}"
            ) from exc
        finally:
            if owns:
                await client.aclose()


from comic_studio.model_runtime.adapters import register_capability
from comic_studio.model_runtime.contracts import Capability

PROVIDER_CAPABILITY = register_capability(Capability.VIDEO, provider_class="MiniMaxVideoProvider")
