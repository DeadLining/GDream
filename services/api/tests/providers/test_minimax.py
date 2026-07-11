import json

import httpx
import pytest

from comic_studio.providers.minimax import MiniMaxProvider


VALID_PLAN = {
    "scenes": [
        {
            "location": "雨夜巷道",
            "time_of_day": "night",
            "summary": "林默发现记忆交易留下的线索",
            "continuity_state": {"weather": "heavy rain"},
            "estimated_duration_seconds": 12,
            "shots": [
                {
                    "shot_type": "close_up",
                    "duration_seconds": 5,
                    "composition": "林默站在霓虹灯下看向手中的芯片",
                    "camera_motion": "push_in",
                    "character_state": {"char-1": {"coat": "black"}},
                    "image_prompt": "Chinese noir comic close-up",
                    "negative_prompt": "extra fingers, text",
                    "dialogue": [
                        {
                            "character_id": "char-1",
                            "text": "这段记忆，不属于死者。",
                            "subtitle_text": "这段记忆，不属于死者。",
                            "emotion": "suspicious",
                            "performance_instruction": "低声、警觉",
                        }
                    ],
                }
            ],
        }
    ]
}


@pytest.mark.anyio
async def test_minimax_uses_m3_anthropic_contract():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(
            200,
            json={"content": [{"type": "text", "text": json.dumps(VALID_PLAN)}]},
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="https://api.minimaxi.com/anthropic"
    ) as client:
        provider = MiniMaxProvider(api_key="secret", client=client)
        plan = await provider.plan_episode({"title": "失窃的雨夜"})

    request = captured["request"]
    body = json.loads(request.content)
    assert request.url.path == "/anthropic/v1/messages"
    assert request.headers["anthropic-version"] == "2023-06-01"
    assert body["model"] == "MiniMax-M3"
    assert plan.scenes[0].shots[0].dialogue[0].character_id == "char-1"


@pytest.mark.anyio
async def test_minimax_retries_once_with_validation_feedback():
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        text = "not json" if len(requests) == 1 else json.dumps(VALID_PLAN)
        return httpx.Response(200, json={"content": [{"type": "text", "text": text}]})

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="https://api.minimaxi.com/anthropic"
    ) as client:
        plan = await MiniMaxProvider(api_key="secret", client=client).plan_episode(
            {"title": "失窃的雨夜"}
        )

    assert len(requests) == 2
    assert "validation" in requests[1]["messages"][-1]["content"].lower()
    assert plan.scenes[0].location == "雨夜巷道"
