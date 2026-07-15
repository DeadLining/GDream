import asyncio

import pytest
from pydantic import ValidationError
from sqlalchemy import func, select

from comic_studio import models
from comic_studio.script_imports import (
    ScriptImportCharacter,
    ScriptImportDialogue,
    ScriptImportDraft,
    ScriptImportEpisode,
    ScriptImportScene,
    ScriptImportShot,
)
from comic_studio.services.script_imports import ScriptImportParserService


def valid_draft() -> ScriptImportDraft:
    return ScriptImportDraft(
        project={"title": "雨夜失忆", "logline": "侦探追查记忆交易"},
        characters=[
            ScriptImportCharacter(
                draft_id="char-linxia",
                name="林夏",
                aliases=["小夏"],
                role="主角",
                appearance_bible="黑色风衣，短发",
                personality="冷静",
                continuity_rules="始终佩戴银色耳钉",
                voice_speaker="female-1",
            )
        ],
        episodes=[
            ScriptImportEpisode(
                draft_id="episode-1",
                title="失窃的雨夜",
                premise="林夏发现记忆芯片",
                target_duration_seconds=60,
                scenes=[
                    ScriptImportScene(
                        location="天台",
                        time_of_day="night",
                        summary="林夏面对追兵",
                        estimated_duration_seconds=8,
                        shots=[
                            ScriptImportShot(
                                shot_type="close_up",
                                duration_seconds=5,
                                composition="雨水滑过林夏的脸",
                                image_prompt="Chinese noir close-up",
                                dialogue=[
                                    ScriptImportDialogue(
                                        speaker_draft_id="char-linxia",
                                        text="别回头。",
                                        subtitle_text="别回头。",
                                    )
                                ],
                            )
                        ],
                    )
                ],
            )
        ],
    )


class FakeImportPlanner:
    def __init__(self):
        self.context = None

    async def parse_script_import(self, context):
        self.context = context
        return valid_draft()


def test_draft_rejects_dialogue_with_unknown_character():
    payload = valid_draft().model_dump()
    payload["episodes"][0]["scenes"][0]["shots"][0]["dialogue"][0][
        "speaker_draft_id"
    ] = "missing"

    with pytest.raises(ValidationError, match="unknown speaker_draft_id"):
        ScriptImportDraft.model_validate(payload)


def test_draft_rejects_character_state_with_unknown_character_key():
    payload = valid_draft().model_dump()
    payload["episodes"][0]["scenes"][0]["shots"][0]["character_state"] = {
        "expression": "紧张",
    }

    with pytest.raises(ValidationError, match="unknown character_state draft_id"):
        ScriptImportDraft.model_validate(payload)


def test_parser_persists_preview_without_mutating_project_graph(db_session):
    project = models.Project(
        title="已有项目",
        logline="原始梗概",
        story_bible="原始设定",
        visual_style="水墨",
        aspect_ratio="9:16",
    )
    existing = models.Character(
        project=project,
        name="旧角色",
        role="配角",
        appearance_bible="灰色外套",
        personality="谨慎",
        continuity_rules="戴眼镜",
        voice_speaker="male-1",
    )
    script_import = models.ScriptImport(
        project=project,
        status="uploaded",
        mode="auto",
        source_format="paste",
        checksum="a" * 64,
        extracted_text="第一场，雨夜天台。林夏：别回头。",
    )
    db_session.add_all([existing, script_import])
    db_session.commit()
    planner = FakeImportPlanner()

    parsed = asyncio.run(
        ScriptImportParserService(db_session, planner).parse(script_import.id)
    )

    assert parsed.status == "ready"
    assert parsed.structured_draft["episodes"][0]["title"] == "失窃的雨夜"
    assert planner.context["mode"] == "auto"
    assert planner.context["existing_characters"] == ["旧角色"]
    assert db_session.scalar(select(func.count()).select_from(models.Character)) == 1
    assert db_session.scalar(select(func.count()).select_from(models.Episode)) == 0


def test_generation_context_uses_project_canon_and_existing_episodes(db_session):
    project = models.Project(
        title="已有项目",
        logline="原始梗概",
        story_bible="原始设定",
        visual_style="水墨",
        aspect_ratio="9:16",
    )
    character = models.Character(
        project=project,
        name="旧角色",
        role="主角",
        appearance_bible="灰色外套",
        personality="谨慎",
        continuity_rules="戴眼镜",
        negative_constraints="不要改变发色",
        voice_speaker="male-1",
        voice_instruction="低沉",
    )
    episode = models.Episode(
        project=project,
        title="旧日回声",
        premise="角色发现旧线索",
        target_duration_seconds=90,
        status="planned",
    )
    scene = models.Scene(
        episode=episode,
        position=1,
        location="档案馆",
        time_of_day="night",
        summary="角色找到被删除的档案",
        continuity_state={"clue": "red-folder"},
        estimated_duration_seconds=12,
    )
    script_import = models.ScriptImport(
        project=project,
        status="uploaded",
        mode="generate",
        source_format="generated",
        checksum="g" * 64,
        extracted_text="聚焦角色冲突",
    )
    db_session.add_all([character, scene, script_import])
    db_session.commit()
    planner = FakeImportPlanner()

    asyncio.run(ScriptImportParserService(db_session, planner).parse(script_import.id))

    assert planner.context["mode"] == "generate"
    assert planner.context["creation_brief"] == "聚焦角色冲突"
    assert "text" not in planner.context
    assert planner.context["project"] == {
        "title": "已有项目",
        "logline": "原始梗概",
        "story_bible": "原始设定",
        "visual_style": "水墨",
        "aspect_ratio": "9:16",
    }
    assert planner.context["characters"][0]["negative_constraints"] == "不要改变发色"
    assert planner.context["characters"][0]["voice_instruction"] == "低沉"
    assert planner.context["existing_episodes"][0]["title"] == "旧日回声"
    assert planner.context["existing_episodes"][0]["scenes"][0]["summary"] == "角色找到被删除的档案"


def test_parser_marks_provider_failure_without_replacing_previous_draft(db_session):
    class FailingPlanner:
        async def parse_script_import(self, context):
            raise RuntimeError("provider sk-secret-token failed")

    project = models.Project(
        title="项目",
        logline="梗概",
        story_bible="设定",
        visual_style="漫画",
        aspect_ratio="9:16",
    )
    script_import = models.ScriptImport(
        project=project,
        status="ready",
        mode="screenplay",
        source_format="txt",
        checksum="b" * 64,
        extracted_text="场景",
        structured_draft={"previous": True},
    )
    db_session.add(script_import)
    db_session.commit()

    with pytest.raises(RuntimeError):
        asyncio.run(
            ScriptImportParserService(db_session, FailingPlanner()).parse(
                script_import.id
            )
        )

    db_session.refresh(script_import)
    assert script_import.status == "failed"
    assert script_import.error_category == "provider_failure"
    assert script_import.structured_draft == {"previous": True}
    assert "secret-token" not in script_import.error


def test_script_parse_route_links_finalized_revision_without_mutating_source(client):
    class Provider:
        async def parse_script_import(self, context):
            return valid_draft()

    class Factory:
        def create_llm(self):
            return Provider()

    client.app.state.provider_factory = Factory()
    project = client.post(
        "/api/projects",
        json={
            "title": "雨夜",
            "logline": "追查芯片",
            "story_bible": "近未来重庆",
            "visual_style": "Chinese noir",
            "aspect_ratio": "9:16",
        },
    ).json()
    script = client.post(
        f"/api/projects/{project['id']}/scripts",
        json={"title": "正文", "source_type": "paste", "content": "第一集：雨夜"},
    ).json()

    response = client.post(f"/api/scripts/{script['id']}/parse")

    assert response.status_code == 200
    parsed = response.json()
    assert parsed["script_revision_id"] == script["current_revision"]["id"]
    assert parsed["extracted_text"] == "第一集：雨夜"
    detail = client.get(f"/api/scripts/{script['id']}").json()
    assert detail["current_revision"]["content"] == "第一集：雨夜"
    assert detail["current_revision"]["status"] == "finalized"

    edited = client.patch(
        f"/api/scripts/{script['id']}",
        json={
            "content": "第二版内容",
            "expected_checksum": detail["current_revision"]["checksum"],
        },
    ).json()
    assert edited["latest_import_id"] == parsed["id"]
    assert edited["parse_is_stale"] is True
