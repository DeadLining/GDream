import base64
import json

import httpx
import pytest

from comic_studio.providers.qwen_tts import QwenTTSProvider


WAV_BYTES = b"RIFF" + b"\x00" * 40


@pytest.mark.anyio
async def test_qwen_tts_sends_character_performance_contract():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(
            200, content=WAV_BYTES, headers={"content-type": "audio/wav"}
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="http://tts.local"
    ) as client:
        audio = await QwenTTSProvider(client=client).synthesize(
            text="别回头。",
            speaker="Dylan",
            language="Chinese",
            instruction="低声、紧张、快速",
        )

    request = captured["request"]
    body = json.loads(request.content)
    assert request.url.path == "/v1/audio/speech"
    assert body["model"] == "Qwen3-TTS-12Hz-1.7B-CustomVoice"
    assert body["speaker"] == "Dylan"
    assert body["instruct"] == "低声、紧张、快速"
    assert audio == WAV_BYTES


@pytest.mark.anyio
async def test_qwen_tts_rejects_non_wav_response():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not audio", headers={"content-type": "text/plain"})

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="http://tts.local"
    ) as client:
        provider = QwenTTSProvider(client=client)
        with pytest.raises(RuntimeError, match="non-WAV"):
            await provider.synthesize("测试", "Dylan", "Chinese", "")


@pytest.mark.anyio
async def test_qwen_tts_falls_back_to_hostbridge_ssh_on_transport_failure():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("unreachable", request=request)

    captured = {}

    def ssh_executor(command, payload):
        captured["command"] = command
        captured["payload"] = payload
        return base64.b64encode(WAV_BYTES)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="http://tts.local"
    ) as client:
        provider = QwenTTSProvider(
            client=client,
            ssh_host="ai-comic-tts",
            ssh_executor=ssh_executor,
        )
        audio = await provider.synthesize("别回头。", "Dylan", "Chinese", "低声")

    assert captured["command"][0:2] == ["ssh", "ai-comic-tts"]
    encoded_payload = (
        captured["command"][2].split("printf '%s' '", 1)[1].split("' |", 1)[0]
    )
    remote_payload = json.loads(base64.b64decode(encoded_payload))
    assert remote_payload["speaker"] == "Dylan"
    assert captured["payload"] == b""
    assert audio == WAV_BYTES


@pytest.mark.anyio
async def test_qwen_tts_falls_back_on_gateway_errors_only():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(502, text="Bad Gateway", request=request)

    def ssh_executor(command, payload):
        return base64.b64encode(WAV_BYTES)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="http://tts.local"
    ) as client:
        audio = await QwenTTSProvider(
            client=client,
            ssh_host="ai-comic-tts",
            ssh_executor=ssh_executor,
        ).synthesize("测试", "Dylan", "Chinese", "")

    assert audio == WAV_BYTES
