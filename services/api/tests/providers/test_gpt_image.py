import base64
import json

import httpx
import pytest

from comic_studio.providers.gpt_image import GPTImageProvider


PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


@pytest.mark.anyio
async def test_generate_panel_uses_gpt_image_2_contract():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(
            200,
            json={"data": [{"b64_json": base64.b64encode(PNG_BYTES).decode()}]},
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="http://image.local"
    ) as client:
        result = await GPTImageProvider(api_key="secret", client=client).generate(
            "Chinese noir comic panel", "1024x1536"
        )

    request = captured["request"]
    body = json.loads(request.content)
    assert request.url.path == "/v1/images/generations"
    assert body["model"] == "gpt-image-2"
    assert body["size"] == "1024x1536"
    assert result.content == PNG_BYTES
    assert result.media_type == "image/png"
