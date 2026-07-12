import base64
import json
import subprocess

import httpx
import pytest

from comic_studio.providers.qwen_tts import QwenTTSProvider


WAV_BYTES = b"RIFF" + b"\x00" * 40


@pytest.mark.anyio
async def test_qwen_tts_healthcheck_uses_lightweight_endpoint():
    captured = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"status": "ok"})

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="http://tts.local"
    ) as client:
        await QwenTTSProvider(client=client).check_health()

    assert captured[0].method == "GET"
    assert captured[0].url.path == "/health"


@pytest.mark.anyio
async def test_qwen_tts_prefer_ssh_skips_direct_client_and_keeps_secret_off_argv():
    secret = "tts-secret-never-in-argv"
    captured = {}

    class UnusedClient:
        async def post(self, *args, **kwargs):
            raise AssertionError("SSH-first synthesis must not use the HTTP client")

    def ssh_executor(command, payload):
        captured["command"] = command
        captured["payload"] = payload
        return base64.b64encode(WAV_BYTES)

    audio = await QwenTTSProvider(
        client=UnusedClient(),
        api_key=secret,
        ssh_host="ai-comic-tts",
        ssh_executor=ssh_executor,
        prefer_ssh=True,
    ).synthesize("测试", "Dylan")

    assert audio == WAV_BYTES
    assert captured["command"][0:2] == ["ssh", "ai-comic-tts"]
    assert secret not in " ".join(captured["command"])
    assert f'header = "Authorization: Bearer {secret}"'.encode() in captured["payload"]


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
async def test_qwen_tts_sends_configured_bearer_token_and_omits_empty_token():
    headers = []

    def handler(request: httpx.Request) -> httpx.Response:
        headers.append(dict(request.headers))
        return httpx.Response(
            200, content=WAV_BYTES, headers={"content-type": "audio/wav"}
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="http://tts.local"
    ) as client:
        await QwenTTSProvider(client=client, api_key="tts-secret").synthesize(
            "测试", "Dylan"
        )
        await QwenTTSProvider(client=client, api_key="").synthesize("测试", "Dylan")

    assert headers[0]["authorization"] == "Bearer tts-secret"
    assert "authorization" not in headers[1]


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
    assert captured["command"][2] == (
        "set -o pipefail; curl -fsS --max-time 180 --config - | base64 -w 0"
    )
    config = captured["payload"].decode()
    assert 'url = "http://127.0.0.1:18080/v1/audio/speech"' in config
    assert 'header = "content-type: application/json"' in config
    data_line = next(line for line in config.splitlines() if line.startswith("data = "))
    escaped_data = data_line.removeprefix('data = "').removesuffix('"')
    remote_payload = json.loads(json.loads(f'"{escaped_data}"'))
    assert remote_payload["speaker"] == "Dylan"
    assert remote_payload["text"] == "别回头。"
    assert remote_payload["instruct"] == "低声"
    assert "别回头。" not in " ".join(captured["command"])
    assert "低声" not in " ".join(captured["command"])
    assert audio == WAV_BYTES


@pytest.mark.anyio
async def test_qwen_tts_ssh_fallback_sends_bearer_header_without_payload_leak():
    secret = "tts-secret-never-in-payload"
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("unreachable", request=request)

    def ssh_executor(command, payload):
        captured["command"] = command
        captured["payload"] = payload
        return base64.b64encode(WAV_BYTES)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="http://tts.local"
    ) as client:
        provider = QwenTTSProvider(
            client=client,
            api_key=secret,
            ssh_host="ai-comic-tts",
            ssh_executor=ssh_executor,
        )
        await provider.synthesize("测试", "Dylan")

    command_text = " ".join(captured["command"])
    assert secret not in command_text
    assert "测试" not in command_text
    assert f'header = "Authorization: Bearer {secret}"'.encode() in captured["payload"]
    assert "测试".encode() in captured["payload"]
    assert secret not in repr(provider)


@pytest.mark.anyio
async def test_qwen_tts_ssh_failure_does_not_leak_bearer_token_in_error():
    secret = "tts-secret-never-in-error"

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("unreachable", request=request)

    def ssh_executor(command, payload):
        raise subprocess.CalledProcessError(
            1,
            command,
            stderr=f"failed with stdin {payload.decode()}".encode(),
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="http://tts.local"
    ) as client:
        provider = QwenTTSProvider(
            client=client,
            api_key=secret,
            ssh_host="ai-comic-tts",
            ssh_executor=ssh_executor,
        )
        with pytest.raises(RuntimeError, match="SSH fallback failed") as caught:
            await provider.synthesize("测试", "Dylan")

    assert secret not in str(caught.value)
    assert secret not in repr(caught.value)
    assert "测试" not in str(caught.value)
    assert "测试" not in repr(caught.value)
    assert caught.value.__cause__ is None


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
