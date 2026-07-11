import json
from copy import deepcopy

import httpx
import pytest

from comic_studio.providers.minimax import MiniMaxProvider
from comic_studio.providers.base import ProviderError


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

VALID_IMPORT_DRAFT = {
    "project": {"title": "雨夜失忆", "logline": "追查记忆交易"},
    "characters": [
        {
            "draft_id": "char-1",
            "name": "林夏",
            "aliases": [],
            "role": "主角",
            "appearance_bible": "黑色风衣",
            "personality": "冷静",
            "continuity_rules": "银色耳钉",
            "negative_constraints": "",
            "voice_speaker": "female-1",
            "voice_instruction": "",
        }
    ],
    "episodes": [
        {
            "draft_id": "episode-1",
            "enabled": True,
            "title": "失窃的雨夜",
            "premise": "林夏发现芯片",
            "target_duration_seconds": 60,
            "scenes": [
                {
                    "location": "天台",
                    "time_of_day": "night",
                    "summary": "林夏面对追兵",
                    "continuity_state": {},
                    "estimated_duration_seconds": 5,
                    "shots": [
                        {
                            "shot_type": "close_up",
                            "duration_seconds": 5,
                            "composition": "林夏回头",
                            "camera_motion": "push_in",
                            "character_state": {"char-1": {"outfit": "coat"}},
                            "image_prompt": "noir close-up",
                            "negative_prompt": "",
                            "dialogue": [
                                {
                                    "speaker_draft_id": "char-1",
                                    "narration": False,
                                    "text": "别回头。",
                                    "subtitle_text": "别回头。",
                                    "emotion": "tense",
                                    "performance_instruction": "低声",
                                }
                            ],
                        }
                    ],
                }
            ],
        }
    ],
    "warnings": [],
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


@pytest.mark.anyio
async def test_minimax_repairs_syntax_but_still_validates_schema():
    damaged = json.dumps(VALID_PLAN, ensure_ascii=False).replace(
        '"location": "雨夜巷道",', '"location": "雨夜巷道"'
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"content": [{"type": "text", "text": damaged}]}
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="https://api.minimaxi.com/anthropic"
    ) as client:
        plan = await MiniMaxProvider(api_key="secret", client=client).plan_episode(
            {"title": "失窃的雨夜"}
        )

    assert plan.scenes[0].location == "雨夜巷道"


@pytest.mark.anyio
async def test_minimax_normalizes_textual_continuity_and_character_state():
    textual = deepcopy(VALID_PLAN)
    textual["scenes"][0]["continuity_state"] = "雨势逐渐减弱"
    textual["scenes"][0]["shots"][0]["character_state"] = "林默握紧芯片"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"content": [{"type": "text", "text": json.dumps(textual)}]}
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="https://api.minimaxi.com/anthropic"
    ) as client:
        plan = await MiniMaxProvider(api_key="secret", client=client).plan_episode({})

    assert plan.scenes[0].continuity_state == {"description": "雨势逐渐减弱"}
    assert plan.scenes[0].shots[0].character_state == {"description": "林默握紧芯片"}


@pytest.mark.anyio
async def test_minimax_extracts_scenes_from_a_wrapped_episode_object():
    wrapped = {"project": {"title": "雨夜"}, "episode": VALID_PLAN}

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"content": [{"type": "text", "text": json.dumps(wrapped)}]}
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="https://api.minimaxi.com/anthropic"
    ) as client:
        plan = await MiniMaxProvider(api_key="secret", client=client).plan_episode({})

    assert plan.scenes[0].location == "雨夜巷道"


@pytest.mark.anyio
async def test_minimax_parses_script_import_with_import_specific_prompt():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"content": [{"type": "text", "text": json.dumps(VALID_IMPORT_DRAFT)}]},
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="https://api.minimaxi.com/anthropic"
    ) as client:
        draft = await MiniMaxProvider(api_key="secret", client=client).parse_script_import(
            {"mode": "prose", "text": "雨夜故事"}
        )

    assert draft.episodes[0].scenes[0].shots[0].dialogue[0].speaker_draft_id == "char-1"
    assert "script import" in captured["body"]["system"].lower()
    assert captured["body"]["messages"][0]["content"].startswith("Structure this script")


@pytest.mark.anyio
async def test_minimax_generates_script_from_project_context():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"content": [{"type": "text", "text": json.dumps(VALID_IMPORT_DRAFT)}]},
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="https://api.minimaxi.com/anthropic"
    ) as client:
        await MiniMaxProvider(api_key="secret", client=client).parse_script_import(
            {"mode": "generate", "project": {"title": "雨夜"}, "creation_brief": "新冲突"}
        )

    assert "create" in captured["body"]["messages"][0]["content"].lower()
    assert "avoid duplicating" in captured["body"]["system"].lower()
    assert '"$defs"' in captured["body"]["messages"][0]["content"]
    assert '"appearance_bible"' in captured["body"]["messages"][0]["content"]


@pytest.mark.anyio
async def test_script_generation_uses_extended_read_timeout(monkeypatch):
    captured = {}

    class Client:
        async def post(self, path, **kwargs):
            return httpx.Response(
                200,
                request=httpx.Request("POST", f"https://api.minimaxi.com/{path}"),
                json={"content": [{"type": "text", "text": json.dumps(VALID_IMPORT_DRAFT)}]},
            )

        async def aclose(self):
            return None

    def client_factory(**kwargs):
        captured.update(kwargs)
        return Client()

    monkeypatch.setattr("comic_studio.providers.minimax.httpx.AsyncClient", client_factory)

    await MiniMaxProvider(api_key="secret").parse_script_import(
        {"mode": "generate", "project": {"title": "雨夜"}}
    )

    assert captured["timeout"] == 240


@pytest.mark.anyio
async def test_script_generation_hoists_episode_warnings_to_draft_root():
    payload = deepcopy(VALID_IMPORT_DRAFT)
    payload["episodes"][0]["warnings"] = [
        {"code": "duration_estimate", "message": "时长为估算值", "path": "episodes.0"}
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"content": [{"type": "text", "text": json.dumps(payload)}]},
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="https://api.minimaxi.com/anthropic"
    ) as client:
        draft = await MiniMaxProvider(api_key="secret", client=client).parse_script_import(
            {"mode": "generate", "project": {"title": "雨夜"}}
        )

    assert draft.warnings[0].code == "duration_estimate"
    assert draft.warnings[0].path == "episodes.0"


@pytest.mark.anyio
async def test_minimax_script_import_retries_once_then_raises_sanitized_error():
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={"content": [{"type": "text", "text": "{}"}]})

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="https://api.minimaxi.com/anthropic"
    ) as client:
        with pytest.raises(ProviderError, match="invalid script import draft"):
            await MiniMaxProvider(api_key="secret", client=client).parse_script_import(
                {"mode": "screenplay", "text": "secret-source-text"}
            )

    assert len(requests) == 2
    assert "validation" in requests[1]["messages"][-1]["content"].lower()
    assert "secret-source-text" not in requests[1]["messages"][-1]["content"]
