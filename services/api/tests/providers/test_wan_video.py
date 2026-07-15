import base64
import json

import httpx
import pytest

from comic_studio.provider_channels import ProviderChannel
from comic_studio.providers.base import ProviderError
from comic_studio.providers.wan_video import WanVideoProvider


MP4 = b"\x00\x00\x00\x18ftypmp42wan-video"


@pytest.mark.anyio
async def test_submit_poll_and_download_wan_video():
    requests = []

    def handler(request: httpx.Request):
        requests.append(request)
        if request.method == "POST" and request.url.path == "/v1/videos":
            return httpx.Response(
                202,
                json={"id": "video_gen_1", "status": "queued"},
            )
        if request.url.path == "/v1/videos/video_gen_1/content":
            return httpx.Response(
                200,
                content=MP4,
                headers={"content-type": "video/mp4"},
            )
        if request.url.path == "/v1/videos/video_gen_1":
            return httpx.Response(
                200,
                json={"id": "video_gen_1", "status": "completed"},
            )
        raise AssertionError(request.url)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="http://192.168.18.94:18081",
    ) as client:
        provider = WanVideoProvider(
            model="Wan-AI/Wan2.2-TI2V-5B",
            client=client,
        )
        task_id = await provider.submit_image_to_video(
            "slow turn",
            b"jpeg-bytes",
            "image/jpeg",
            6,
        )
        task = await provider.get_task(task_id)
        result = await provider.download_result(task)

    assert task_id == "video_gen_1"
    assert task.status == "succeeded"
    assert task.file_id == "video_gen_1"
    assert result.content == MP4
    submit = requests[0]
    assert submit.headers["content-type"].startswith("multipart/form-data;")
    assert b'name="prompt"' in submit.content
    assert b"slow turn" in submit.content
    assert b'name="input_reference"' in submit.content
    assert b"jpeg-bytes" in submit.content
    assert b'name="num_frames"' in submit.content
    assert b"121" in submit.content
    assert b'name="fps"' in submit.content
    assert b"20" in submit.content
    assert "authorization" not in submit.headers


def test_wan_provider_matches_only_wan_channels():
    class Channel:
        model = "Wan-AI/Wan2.2-TI2V-5B"
        base_url = "http://192.168.18.94:18081"

    assert WanVideoProvider.supports_channel(Channel()) is True
    Channel.model = "MiniMax-Hailuo-02"
    assert WanVideoProvider.supports_channel(Channel()) is False


@pytest.mark.anyio
async def test_wan_video_prefers_owned_mock_ssh_and_keeps_inputs_off_argv():
    captured = []

    class UnusedClient:
        async def post(self, *args, **kwargs):
            raise AssertionError("SSH-first submission must skip direct HTTP")

    def ssh_executor(command, payload):
        captured.append((command, json.loads(payload)))
        return json.dumps({"id": "video_gen_ssh"}).encode()

    provider = WanVideoProvider(
        api_key="video-secret",
        client=UnusedClient(),
        ssh_host="hostbridge-a800_94",
        ssh_executor=ssh_executor,
        prefer_ssh=True,
    )
    task_id = await provider.submit_image_to_video(
        "镜头缓慢推进，角色回头。",
        b"binary-image",
        "image/jpeg",
        6,
    )

    command, payload = captured[0]
    assert task_id == "video_gen_ssh"
    assert command[:2] == ["ssh", "hostbridge-a800_94"]
    assert "video-secret" not in " ".join(command)
    assert "镜头缓慢推进" not in " ".join(command)
    assert payload["action"] == "submit"
    assert payload["prompt"] == "镜头缓慢推进，角色回头。"
    assert base64.b64decode(payload["image_base64"]) == b"binary-image"
    assert payload["api_key"] == "video-secret"


@pytest.mark.anyio
@pytest.mark.parametrize("failure", ["transport", "503"])
async def test_wan_video_falls_back_to_mock_ssh_on_direct_gateway_failure(failure):
    def handler(request: httpx.Request):
        if failure == "transport":
            raise httpx.ConnectError("direct unavailable", request=request)
        return httpx.Response(503, request=request)

    calls = []

    def ssh_executor(command, payload):
        calls.append((command, json.loads(payload)))
        return json.dumps({"id": "video_gen_fallback"}).encode()

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="http://192.168.18.94:18081",
    ) as client:
        provider = WanVideoProvider(
            client=client,
            ssh_host="hostbridge-a800_94",
            ssh_executor=ssh_executor,
        )
        task_id = await provider.submit_image_to_video(
            "fallback",
            b"image",
            "image/png",
            5,
        )

    assert task_id == "video_gen_fallback"
    assert calls[0][1]["action"] == "submit"


@pytest.mark.anyio
async def test_wan_video_does_not_fall_back_on_client_error():
    def handler(request: httpx.Request):
        return httpx.Response(400, request=request)

    def ssh_executor(command, payload):
        raise AssertionError("HTTP 400 must not fall back to SSH")

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="http://192.168.18.94:18081",
    ) as client:
        provider = WanVideoProvider(
            client=client,
            ssh_host="hostbridge-a800_94",
            ssh_executor=ssh_executor,
        )
        with pytest.raises(ProviderError, match="HTTP 400"):
            await provider.submit_image_to_video(
                "bad request",
                b"image",
                "image/png",
                5,
            )


@pytest.mark.anyio
async def test_wan_video_polls_and_downloads_through_mock_ssh():
    actions = []

    def ssh_executor(command, payload):
        request = json.loads(payload)
        actions.append(request)
        if request["action"] == "task":
            return json.dumps(
                {"id": request["task_id"], "status": "completed"}
            ).encode()
        if request["action"] == "download":
            return base64.b64encode(MP4)
        raise AssertionError(request)

    provider = WanVideoProvider(
        ssh_host="hostbridge-a800_94",
        ssh_executor=ssh_executor,
        prefer_ssh=True,
    )
    task = await provider.get_task("video_gen_1")
    result = await provider.download_result(task)

    assert [item["action"] for item in actions] == ["task", "download"]
    assert result.content == MP4


@pytest.mark.anyio
async def test_wan_video_rejects_invalid_ssh_download_without_leaking_secret():
    secret = "video-secret-never-in-error"

    def ssh_executor(command, payload):
        request = json.loads(payload)
        if request["action"] == "task":
            return json.dumps(
                {"id": request["task_id"], "status": "completed"}
            ).encode()
        return b"not-base64"

    provider = WanVideoProvider(
        api_key=secret,
        ssh_host="hostbridge-a800_94",
        ssh_executor=ssh_executor,
        prefer_ssh=True,
    )
    task = await provider.get_task("video_gen_1")

    with pytest.raises(ProviderError, match="invalid Base64") as caught:
        await provider.download_result(task)

    assert secret not in str(caught.value)
    assert secret not in repr(caught.value)


@pytest.mark.anyio
async def test_wan_video_rejects_unsafe_task_id_before_ssh_execution():
    def ssh_executor(command, payload):
        raise AssertionError("unsafe task IDs must never reach SSH")

    provider = WanVideoProvider(
        ssh_host="hostbridge-a800_94",
        ssh_executor=ssh_executor,
        prefer_ssh=True,
    )

    with pytest.raises(ProviderError, match="invalid task id"):
        await provider.get_task("task; rm -rf /")


def test_wan_video_rejects_unsafe_ssh_alias():
    with pytest.raises(ValueError, match="Invalid SSH host alias"):
        WanVideoProvider(ssh_host="host; rm -rf /")


def test_wan_video_from_channel_evaluates_owned_alias_predicate():
    channel = ProviderChannel(
        name="Wan Local",
        enabled=True,
        base_url="http://192.168.18.94:18081",
        model="Wan-AI/Wan2.2-TI2V-5B",
        ssh_host="hostbridge-a800_94",
    )

    owned = WanVideoProvider.from_channel(
        channel,
        prefer_ssh_for_host=lambda alias: alias == "hostbridge-a800_94",
    )
    unowned = WanVideoProvider.from_channel(
        channel,
        prefer_ssh_for_host=lambda alias: False,
    )

    assert owned.ssh_host == "hostbridge-a800_94"
    assert owned.prefer_ssh is True
    assert unowned.prefer_ssh is False
