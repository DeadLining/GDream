from __future__ import annotations

import asyncio
import base64
import json
import re
import subprocess
from collections.abc import Callable
from urllib.parse import urlsplit

import httpx
from pydantic import SecretStr

from comic_studio.model_runtime.adapters import register_capability
from comic_studio.model_runtime.contracts import Capability
from comic_studio.providers.base import ProviderError
from comic_studio.providers.video_base import VideoResult, VideoTask


_SAFE_SSH_ALIAS = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_SAFE_TASK_ID = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
_GATEWAY_STATUS_CODES = {502, 503, 504}
_REMOTE_SCRIPT = r'''
import base64
import json
import sys
import urllib.request
import uuid

payload = json.load(sys.stdin)
port = int(payload["port"])
if port < 1 or port > 65535:
    raise ValueError("invalid port")
base_url = f"http://127.0.0.1:{port}"
headers = {}
if payload.get("api_key"):
    headers["Authorization"] = f"Bearer {payload['api_key']}"

def call(path, method="GET", body=None, extra_headers=None, timeout=120):
    request_headers = dict(headers)
    request_headers.update(extra_headers or {})
    request = urllib.request.Request(
        base_url + path,
        data=body,
        headers=request_headers,
        method=method,
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()

action = payload["action"]
if action == "health":
    output = call("/v1/models", timeout=30)
elif action == "submit":
    boundary = "----comic-studio-" + uuid.uuid4().hex
    body = bytearray()
    fields = {
        "prompt": payload["prompt"],
        "size": "1280x704",
        "num_frames": "121",
        "fps": str(payload["fps"]),
        "num_inference_steps": "50",
        "guidance_scale": "5",
    }
    for name, value in fields.items():
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        body.extend(str(value).encode("utf-8"))
        body.extend(b"\r\n")
    image = base64.b64decode(payload["image_base64"], validate=True)
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(b'Content-Disposition: form-data; name="input_reference"; filename="input.bin"\r\n')
    body.extend(f"Content-Type: {payload['image_media_type']}\r\n\r\n".encode())
    body.extend(image)
    body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode())
    output = call(
        "/v1/videos",
        method="POST",
        body=bytes(body),
        extra_headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        timeout=120,
    )
elif action == "task":
    output = call(f"/v1/videos/{payload['task_id']}", timeout=30)
elif action == "download":
    content = call(f"/v1/videos/{payload['task_id']}/content", timeout=240)
    output = base64.b64encode(content)
else:
    raise ValueError("unsupported action")
sys.stdout.buffer.write(output)
'''.strip()
_REMOTE_COMMAND = (
    "python3 -c \"import base64;"
    "exec(base64.b64decode('"
    + base64.b64encode(_REMOTE_SCRIPT.encode()).decode()
    + "'))\""
)


class WanVideoProvider:
    provider_id = "wan-video"

    def __init__(
        self,
        api_key: str | None = None,
        *,
        model: str = "Wan-AI/Wan2.2-TI2V-5B",
        base_url: str = "http://192.168.18.94:18081",
        client: httpx.AsyncClient | None = None,
        ssh_host: str | None = None,
        ssh_executor: Callable[[list[str], bytes], bytes] | None = None,
        prefer_ssh: bool = False,
    ):
        normalized_ssh_host = ssh_host.strip() if ssh_host else None
        if normalized_ssh_host and not _SAFE_SSH_ALIAS.fullmatch(normalized_ssh_host):
            raise ValueError("Invalid SSH host alias")
        self._api_key = SecretStr((api_key or "").strip())
        self.model = model
        self.base_url = base_url.rstrip("/")
        self._client = client
        self.ssh_host = normalized_ssh_host
        self.ssh_executor = ssh_executor or self._default_ssh_executor
        self.prefer_ssh = prefer_ssh

    @classmethod
    def supports_channel(cls, channel) -> bool:
        return str(channel.model).casefold().startswith("wan-ai/wan2.2-ti2v-")

    @classmethod
    def from_channel(cls, channel, *, prefer_ssh_for_host=None, **_kwargs):
        ssh_host = channel.ssh_host
        return cls(
            channel.api_key_value,
            model=channel.model,
            base_url=channel.base_url,
            ssh_host=ssh_host,
            prefer_ssh=cls._evaluate_prefer_ssh(
                ssh_host,
                prefer_ssh_for_host,
            ),
        )

    @staticmethod
    def _evaluate_prefer_ssh(ssh_host, prefer_ssh_for_host) -> bool:
        if not ssh_host or prefer_ssh_for_host is None:
            return False
        try:
            return bool(prefer_ssh_for_host(ssh_host))
        except Exception:
            return False

    def _headers(self) -> dict[str, str]:
        api_key = self._api_key.get_secret_value()
        return {"Authorization": f"Bearer {api_key}"} if api_key else {}

    async def check_health(self) -> None:
        if self.prefer_ssh and self.ssh_host:
            content = await asyncio.to_thread(self._request_via_ssh, "health")
            self._validate_models(content)
            return
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(30, connect=3),
        )
        try:
            response = await client.get("v1/models", headers=self._headers())
            response.raise_for_status()
            self._validate_models_payload(response.json())
        except httpx.TransportError as exc:
            if self.ssh_host:
                content = await asyncio.to_thread(self._request_via_ssh, "health")
                self._validate_models(content)
                return
            raise ProviderError("Wan video health check failed") from exc
        except httpx.HTTPStatusError as exc:
            if self.ssh_host and exc.response.status_code in _GATEWAY_STATUS_CODES:
                content = await asyncio.to_thread(self._request_via_ssh, "health")
                self._validate_models(content)
                return
            raise ProviderError(
                f"Wan video health check failed with HTTP {exc.response.status_code}"
            ) from exc
        finally:
            if owns_client:
                await client.aclose()

    async def submit_image_to_video(
        self,
        prompt: str,
        image_bytes: bytes,
        image_media_type: str,
        duration: float,
    ) -> str:
        fps = max(1, min(24, round(120 / max(duration, 1))))
        ssh_payload = {
            "prompt": prompt,
            "image_base64": base64.b64encode(image_bytes).decode(),
            "image_media_type": image_media_type,
            "fps": fps,
        }
        if self.prefer_ssh and self.ssh_host:
            content = await asyncio.to_thread(
                self._request_via_ssh,
                "submit",
                ssh_payload,
            )
            return self._parse_task_id(content)

        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(120, connect=3),
        )
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
            return self._parse_task_id(response.content)
        except httpx.TransportError as exc:
            if self.ssh_host:
                content = await asyncio.to_thread(
                    self._request_via_ssh,
                    "submit",
                    ssh_payload,
                )
                return self._parse_task_id(content)
            raise ProviderError(
                f"Wan video submit failed: {type(exc).__name__}"
            ) from exc
        except httpx.HTTPStatusError as exc:
            if self.ssh_host and exc.response.status_code in _GATEWAY_STATUS_CODES:
                content = await asyncio.to_thread(
                    self._request_via_ssh,
                    "submit",
                    ssh_payload,
                )
                return self._parse_task_id(content)
            raise ProviderError(
                f"Wan video submit failed with HTTP {exc.response.status_code}"
            ) from exc
        finally:
            if owns_client:
                await client.aclose()

    async def get_task(self, task_id: str) -> VideoTask:
        self._validate_task_id(task_id)
        if self.prefer_ssh and self.ssh_host:
            content = await asyncio.to_thread(
                self._request_via_ssh,
                "task",
                {"task_id": task_id},
            )
            return self._parse_task(task_id, content)

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
            return self._parse_task(task_id, response.content)
        except httpx.TransportError as exc:
            if self.ssh_host:
                content = await asyncio.to_thread(
                    self._request_via_ssh,
                    "task",
                    {"task_id": task_id},
                )
                return self._parse_task(task_id, content)
            raise ProviderError(
                f"Wan video query failed: {type(exc).__name__}"
            ) from exc
        except httpx.HTTPStatusError as exc:
            if self.ssh_host and exc.response.status_code in _GATEWAY_STATUS_CODES:
                content = await asyncio.to_thread(
                    self._request_via_ssh,
                    "task",
                    {"task_id": task_id},
                )
                return self._parse_task(task_id, content)
            raise ProviderError(
                f"Wan video query failed with HTTP {exc.response.status_code}"
            ) from exc
        finally:
            if owns_client:
                await client.aclose()

    async def download_result(self, task: VideoTask) -> VideoResult:
        if task.status != "succeeded" or not task.file_id:
            raise ProviderError("video_task_not_ready")
        self._validate_task_id(task.file_id)
        if self.prefer_ssh and self.ssh_host:
            encoded = await asyncio.to_thread(
                self._request_via_ssh,
                "download",
                {"task_id": task.file_id},
            )
            return VideoResult(self._decode_mp4(encoded))

        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(240, connect=3),
        )
        try:
            response = await client.get(
                f"/v1/videos/{task.file_id}/content",
                headers=self._headers() or None,
            )
            response.raise_for_status()
            return VideoResult(self._validate_mp4(response.content))
        except httpx.TransportError as exc:
            if self.ssh_host:
                encoded = await asyncio.to_thread(
                    self._request_via_ssh,
                    "download",
                    {"task_id": task.file_id},
                )
                return VideoResult(self._decode_mp4(encoded))
            raise ProviderError(
                f"Wan video download failed: {type(exc).__name__}"
            ) from exc
        except httpx.HTTPStatusError as exc:
            if self.ssh_host and exc.response.status_code in _GATEWAY_STATUS_CODES:
                encoded = await asyncio.to_thread(
                    self._request_via_ssh,
                    "download",
                    {"task_id": task.file_id},
                )
                return VideoResult(self._decode_mp4(encoded))
            raise ProviderError(
                f"Wan video download failed with HTTP {exc.response.status_code}"
            ) from exc
        finally:
            if owns_client:
                await client.aclose()

    def _request_via_ssh(
        self,
        action: str,
        values: dict | None = None,
    ) -> bytes:
        payload = {
            "action": action,
            "port": self._remote_port(),
            "api_key": self._api_key.get_secret_value(),
            "model": self.model,
            **(values or {}),
        }
        try:
            return self.ssh_executor(
                ["ssh", self.ssh_host or "", _REMOTE_COMMAND],
                json.dumps(
                    payload,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ).encode(),
            )
        except subprocess.TimeoutExpired:
            raise TimeoutError("Wan video SSH request timed out") from None
        except Exception:
            raise ProviderError("Wan video SSH request failed") from None

    def _remote_port(self) -> int:
        parsed = urlsplit(self.base_url)
        try:
            return parsed.port or (443 if parsed.scheme == "https" else 80)
        except ValueError:
            raise ProviderError("Wan video Base URL has an invalid port") from None

    @staticmethod
    def _default_ssh_executor(command: list[str], payload: bytes) -> bytes:
        result = subprocess.run(
            command,
            input=payload,
            capture_output=True,
            check=True,
            timeout=300,
        )
        return result.stdout

    def _validate_models(self, content: bytes) -> None:
        self._validate_models_payload(self._parse_json(content, "models"))

    def _validate_models_payload(self, payload: dict) -> None:
        model_ids = {
            str(item.get("id"))
            for item in payload.get("data", [])
            if isinstance(item, dict) and item.get("id")
        }
        if model_ids and self.model not in model_ids:
            raise ProviderError("Configured Wan video model is unavailable")

    @classmethod
    def _parse_task_id(cls, content: bytes) -> str:
        payload = cls._parse_json(content, "submit")
        task_id = str(payload.get("id") or "")
        if not task_id:
            raise ProviderError("Wan video returned no task id")
        cls._validate_task_id(task_id)
        return task_id

    @classmethod
    def _parse_task(cls, task_id: str, content: bytes) -> VideoTask:
        payload = cls._parse_json(content, "task")
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

    @staticmethod
    def _parse_json(content: bytes, operation: str) -> dict:
        try:
            payload = json.loads(content)
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError):
            raise ProviderError(
                f"Wan video returned invalid {operation} data"
            ) from None
        if not isinstance(payload, dict):
            raise ProviderError(f"Wan video returned invalid {operation} data")
        return payload

    @staticmethod
    def _validate_task_id(task_id: str) -> None:
        if not _SAFE_TASK_ID.fullmatch(task_id):
            raise ProviderError("Wan video returned an invalid task id")

    @classmethod
    def _decode_mp4(cls, encoded: bytes) -> bytes:
        try:
            content = base64.b64decode(encoded.strip(), validate=True)
        except ValueError:
            raise ProviderError(
                "Wan video SSH request returned invalid Base64"
            ) from None
        return cls._validate_mp4(content)

    @staticmethod
    def _validate_mp4(content: bytes) -> bytes:
        if b"ftyp" not in content[:32]:
            raise ProviderError("Wan video returned invalid MP4 data")
        return content


PROVIDER_CAPABILITY = register_capability(
    Capability.VIDEO,
    provider_class="WanVideoProvider",
)
