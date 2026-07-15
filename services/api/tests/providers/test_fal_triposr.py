import httpx
import pytest

from comic_studio.providers.base import ProviderError
from comic_studio.providers.fal_triposr import FalTripoSRProvider
from tests.test_character_3d_representations import _glb


@pytest.mark.anyio
async def test_triposr_uploads_local_reference_generates_and_downloads_glb():
    calls: list[httpx.Request] = []
    generated = _glb()

    def handle(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.host == "rest.fal.ai":
            assert request.headers["Authorization"] == "Key fal-secret"
            assert request.url.params["storage_type"] == "gcs"
            assert request.read() == b'{"file_name":"reference.png","content_type":"image/png"}'
            return httpx.Response(
                200,
                json={
                    "upload_url": "https://storage.googleapis.com/fal-upload/reference",
                    "file_url": "https://v3b.fal.media/files/reference.png",
                },
            )
        if request.url.host == "storage.googleapis.com":
            assert request.method == "PUT"
            assert request.headers["Content-Type"] == "image/png"
            assert request.read() == b"png-bytes"
            return httpx.Response(200)
        if request.url.host == "fal.run":
            assert request.headers["Authorization"] == "Key fal-secret"
            assert request.url.path == "/fal-ai/triposr"
            assert request.read() == (
                b'{"image_url":"https://v3b.fal.media/files/reference.png",'
                b'"output_format":"glb","do_remove_background":true,'
                b'"foreground_ratio":0.9,"mc_resolution":256}'
            )
            return httpx.Response(
                200,
                json={
                    "model_mesh": {
                        "url": "https://v3b.fal.media/files/generated.glb",
                        "content_type": "model/gltf-binary",
                    }
                },
            )
        assert request.url == "https://v3b.fal.media/files/generated.glb"
        return httpx.Response(200, content=generated)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await FalTripoSRProvider(
            "fal-secret",
            client=client,
        ).generate_model(b"png-bytes", "image/png", "reference.png")

    assert result.content == generated
    assert result.source_url == "https://v3b.fal.media/files/generated.glb"
    assert [request.method for request in calls] == ["POST", "PUT", "POST", "GET"]


@pytest.mark.anyio
async def test_triposr_rejects_non_https_provider_file_urls():
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.host == "rest.fal.ai":
            return httpx.Response(
                200,
                json={
                    "upload_url": "https://upload.example.com/reference",
                    "file_url": "http://127.0.0.1/private.png",
                },
            )
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(ProviderError, match="invalid upload response"):
            await FalTripoSRProvider("fal-secret", client=client).generate_model(
                b"png-bytes", "image/png", "reference.png"
            )


@pytest.mark.anyio
async def test_triposr_rejects_untrusted_signed_upload_hosts():
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.host == "rest.fal.ai":
            return httpx.Response(
                200,
                json={
                    "upload_url": "https://attacker.example/upload",
                    "file_url": "https://v3b.fal.media/files/reference.png",
                },
            )
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(ProviderError, match="untrusted upload URL"):
            await FalTripoSRProvider("fal-secret", client=client).generate_model(
                b"png-bytes", "image/png", "reference.png"
            )


@pytest.mark.anyio
async def test_triposr_stops_streaming_when_model_exceeds_the_limit():
    class OversizedStream(httpx.AsyncByteStream):
        chunks_read = 0

        async def __aiter__(self):
            for chunk in (b"1234", b"5678"):
                self.chunks_read += 1
                yield chunk
            raise AssertionError("provider read beyond the configured byte limit")

    stream = OversizedStream()

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.host == "rest.fal.ai":
            return httpx.Response(
                200,
                json={
                    "upload_url": "https://storage.googleapis.com/fal-upload/reference",
                    "file_url": "https://v3b.fal.media/files/reference.png",
                },
            )
        if request.url.host == "storage.googleapis.com":
            return httpx.Response(200)
        if request.url.host == "fal.run":
            return httpx.Response(
                200,
                json={"model_mesh": {"url": "https://v3b.fal.media/files/large.glb"}},
            )
        return httpx.Response(200, stream=stream)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        provider = FalTripoSRProvider("fal-secret", client=client)
        provider.max_model_bytes = 5
        with pytest.raises(ProviderError, match="model is too large"):
            await provider.generate_model(
                b"png-bytes", "image/png", "reference.png"
            )

    assert stream.chunks_read == 2
