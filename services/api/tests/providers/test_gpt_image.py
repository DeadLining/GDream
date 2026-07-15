import base64
import json

import httpx
import pytest

from comic_studio.providers.gpt_image import GPTImageProvider, prepare_edit_reference
from comic_studio.providers.base import ProviderError, ProviderHTTPError


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


@pytest.mark.anyio
async def test_edit_sends_multiple_reference_files():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(
            200, json={"data": [{"b64_json": base64.b64encode(b"edited").decode()}]}
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="https://images.test"
    ) as client:
        result = await GPTImageProvider(
            "secret", client=client, base_url="https://images.test"
        ).edit("keep character", [(b"one", "image/png"), (b"two", "image/jpeg")])

    request = captured["request"]
    assert request.url.path == "/v1/images/edits"
    assert request.content.count(b'name="image[]"') == 2
    assert b'name="quality"' in request.content
    assert b"\r\n\r\nlow\r\n" in request.content
    assert result.content == b"edited"


def test_large_edit_reference_is_downscaled_to_256_pixels():
    from io import BytesIO
    from PIL import Image

    source = BytesIO()
    Image.new("RGB", (512, 1024), "yellow").save(source, format="PNG")

    content, media_type = prepare_edit_reference(source.getvalue(), "image/png")

    with Image.open(BytesIO(content)) as prepared:
        assert prepared.size == (128, 256)
    assert media_type == "image/jpeg"


def test_high_detail_edit_reference_can_keep_1024_pixels():
    from io import BytesIO
    from PIL import Image

    source = BytesIO()
    Image.new("RGB", (512, 1024), "white").save(source, format="PNG")

    content, media_type = prepare_edit_reference(
        source.getvalue(), "image/png", max_dimension=1024
    )

    with Image.open(BytesIO(content)) as prepared:
        assert prepared.size == (512, 1024)
    assert media_type == "image/png"


@pytest.mark.anyio
async def test_edit_reports_unsupported_endpoint():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "missing"})

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="https://images.test"
    ) as client:
        with pytest.raises(ProviderError, match="reference_edit_unsupported"):
            await GPTImageProvider(
                "secret", client=client, base_url="https://images.test"
            ).edit("prompt", [(b"one", "image/png")])


@pytest.mark.anyio
async def test_edit_preserves_safe_http_status_and_business_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            503,
            json={"error": {"message": "image workers are busy"}},
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="https://images.test"
    ) as client:
        with pytest.raises(ProviderHTTPError) as raised:
            await GPTImageProvider(
                "secret", client=client, base_url="https://images.test"
            ).edit("prompt", [(b"one", "image/png")])

    assert raised.value.status_code == 503
    assert str(raised.value) == "GPT Image HTTP 503: image workers are busy"
