import httpx
import pytest

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
