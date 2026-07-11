import base64

import httpx
import pytest

from comic_studio.providers.minimax_video import MiniMaxVideoProvider


@pytest.mark.anyio
async def test_submit_poll_and_download_video():
    requests = []

    def handler(request: httpx.Request):
        requests.append(request)
        if request.url.path.endswith("/query/video_generation"):
            return httpx.Response(200, json={"status": "Success", "file_id": "file-1"})
        if request.url.path.endswith("/video_generation"):
            return httpx.Response(200, json={"task_id": "task-1"})
        if request.url.path.endswith("/files/retrieve"):
            return httpx.Response(
                200, json={"file": {"download_url": "https://cdn.test/video.mp4"}}
            )
        if request.url.host == "cdn.test":
            return httpx.Response(
                200,
                content=b"\x00\x00\x00\x18ftypmp42video",
                headers={"content-type": "video/mp4"},
            )
        raise AssertionError(request.url)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="https://api.minimaxi.com"
    ) as client:
        provider = MiniMaxVideoProvider("secret", client=client)
        task_id = await provider.submit_image_to_video(
            "slow push", b"png", "image/png", 6
        )
        task = await provider.get_task(task_id)
        result = await provider.download_result(task)
    assert task_id == "task-1"
    assert task.status == "succeeded"
    assert result.content.startswith(b"\x00\x00\x00\x18ftyp")
    submit = requests[0]
    assert base64.b64encode(b"png") in submit.content


@pytest.mark.anyio
async def test_failed_task_returns_sanitized_failure():
    def handler(request: httpx.Request):
        return httpx.Response(
            200,
            json={
                "status": "Fail",
                "error_message": "Bearer secret remote URL https://secret.test",
            },
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="https://api.minimaxi.com"
    ) as client:
        task = await MiniMaxVideoProvider("secret", client=client).get_task("task-1")
    assert task.status == "failed"
    assert "secret.test" not in task.error
