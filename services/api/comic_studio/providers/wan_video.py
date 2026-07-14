from __future__ import annotations

import httpx

from comic_studio.model_runtime.adapters import register_capability
from comic_studio.model_runtime.contracts import Capability
from comic_studio.providers.base import ProviderError
from comic_studio.providers.video_base import VideoResult, VideoTask


class WanVideoProvider:
    provider_id = "wan-video"

    def __init__(
        self,
        api_key: str | None = None,
        *,
        model: str = "Wan-AI/Wan2.2-TI2V-5B",
        base_url: str = "http://192.168.18.94:18081",
        client: httpx.AsyncClient | None = None,
    ):
        self.api_key = api_key or ""
        self.model = model
        self.base_url = base_url.rstrip("/")
        self._client = client

    @classmethod
    def supports_channel(cls, channel) -> bool:
        return str(channel.model).casefold().startswith("wan-ai/wan2.2-ti2v-")

    @classmethod
    def from_channel(cls, channel, **_kwargs):
        return cls(
            channel.api_key_value,
            model=channel.model,
            base_url=channel.base_url,
        )

    def _headers(self) -> dict[str, str]:
        return (
            {"Authorization": f"Bearer {self.api_key}"}
            if self.api_key
            else {}
        )

    async def submit_image_to_video(
        self,
        prompt: str,
        image_bytes: bytes,
        image_media_type: str,
        duration: float,
    ) -> str:
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(120, connect=3),
        )
        fps = max(1, min(24, round(120 / max(duration, 1))))
        suffix = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
        }.get(image_media_type, ".bin")
        try:
            response = await client.post(
                "/v1/videos",
                headers=self._headers() or None,
                data={
                    "prompt": prompt,
                    "size": "1280x704",
                    "num_frames": "121",
                    "fps": str(fps),
                    "num_inference_steps": "50",
                    "guidance_scale": "5",
                },
                files={
                    "input_reference": (
                        f"input{suffix}",
                        image_bytes,
                        image_media_type,
                    )
                },
            )
            response.raise_for_status()
            task_id = response.json().get("id")
            if not task_id:
                raise ProviderError("Wan video returned no task id")
            return str(task_id)
        except httpx.HTTPError as exc:
            raise ProviderError(
                f"Wan video submit failed: {type(exc).__name__}"
            ) from exc
        finally:
            if owns_client:
                await client.aclose()

    async def get_task(self, task_id: str) -> VideoTask:
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(30, connect=3),
        )
        try:
            response = await client.get(
                f"/v1/videos/{task_id}",
                headers=self._headers() or None,
            )
            response.raise_for_status()
            payload = response.json()
            raw_status = str(payload.get("status", "")).casefold()
            status = (
                "succeeded"
                if raw_status == "completed"
                else "failed"
                if raw_status == "failed"
                else "processing"
                if raw_status == "running"
                else "queued"
            )
            return VideoTask(
                task_id,
                status,
                task_id if status == "succeeded" else None,
                "video_task_failed" if status == "failed" else "",
            )
        except httpx.HTTPError as exc:
            raise ProviderError(
                f"Wan video query failed: {type(exc).__name__}"
            ) from exc
        finally:
            if owns_client:
                await client.aclose()

    async def download_result(self, task: VideoTask) -> VideoResult:
        if task.status != "succeeded" or not task.file_id:
            raise ProviderError("video_task_not_ready")
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(120, connect=3),
        )
        try:
            response = await client.get(
                f"/v1/videos/{task.file_id}/content",
                headers=self._headers() or None,
            )
            response.raise_for_status()
            if b"ftyp" not in response.content[:32]:
                raise ProviderError("Wan video returned invalid MP4 data")
            return VideoResult(response.content)
        except httpx.HTTPError as exc:
            raise ProviderError(
                f"Wan video download failed: {type(exc).__name__}"
            ) from exc
        finally:
            if owns_client:
                await client.aclose()


PROVIDER_CAPABILITY = register_capability(
    Capability.VIDEO,
    provider_class="WanVideoProvider",
)
