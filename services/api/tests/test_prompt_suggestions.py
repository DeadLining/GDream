from __future__ import annotations

import math

import pytest
from pydantic import ValidationError

from comic_studio import models
from comic_studio.prompt_suggestions import MediaPromptSuggestion
from comic_studio.services.director_stages import DirectorStageService
from comic_studio.services.prompt_suggestions import PromptSuggestionService


class FakePromptProvider:
    def __init__(self):
        self.context = None

    async def suggest_media_prompt(self, context):
        self.context = context
        return MediaPromptSuggestion(
            mode=context["mode"],
            prompt="雨夜近景，角色回头，保持黑色风衣和银色耳钉一致",
            negative_prompt="身份漂移，额外肢体，文字水印",
            rationale="结合角色设定、上一镜头和机位信息",
            used_context=["character", "previous_shot", "director_camera"],
        )


def test_prompt_suggestion_rejects_blank_prompt_and_oversized_context_labels():
    with pytest.raises(ValidationError):
        MediaPromptSuggestion(mode="panel", prompt="   ")
    with pytest.raises(ValidationError):
        MediaPromptSuggestion(
            mode="panel", prompt="valid", used_context=["x" * 81]
        )


def _graph(session):
    project = models.Project(
        title="雨夜",
        logline="追查芯片",
        story_bible="记忆可交易",
        visual_style="中国黑色漫画",
        aspect_ratio="9:16",
    )
    character = models.Character(
        project=project,
        name="林夏",
        role="主角",
        appearance_bible="黑色风衣",
        personality="冷静",
        continuity_rules="银色耳钉始终在左耳",
        negative_constraints="不要改变发色",
        voice_speaker="female-1",
    )
    episode = models.Episode(
        project=project,
        title="第一集",
        premise="追查芯片",
        target_duration_seconds=60,
    )
    scene = models.Scene(
        episode=episode,
        position=1,
        location="天台",
        time_of_day="night",
        summary="雨夜追逐",
        continuity_state={"weather": "rain"},
        estimated_duration_seconds=10,
    )
    previous = models.Shot(
        scene=scene,
        position=1,
        shot_type="wide",
        duration_seconds=4,
        composition="角色冲上天台",
        camera_motion="follow",
        character_state={"character-1": {"injury": "left arm"}},
        image_prompt="wide rainy rooftop",
        negative_prompt="",
    )
    shot = models.Shot(
        scene=scene,
        position=2,
        shot_type="close_up",
        duration_seconds=3,
        composition="角色回头示警",
        camera_motion="push_in",
        character_state={"character-1": {"emotion": "tense"}},
        image_prompt="existing prompt",
        negative_prompt="existing negative",
        video_prompt="existing motion",
        negative_video_prompt="existing video negative",
    )
    variant = models.AssetVariant(
        character=character,
        episode_id=None,
        kind="master",
        label="黑色风衣主造型",
        overrides={"costume": "black coat"},
        review_status="approved",
    )
    session.add(project)
    session.flush()
    usage = models.AssetVariantUsage(
        variant=variant,
        shot_id=shot.id,
        usage_kind="character",
    )
    review = models.VisualReviewThread(
        episode_id=episode.id,
        shot_id=shot.id,
        title="眉眼情绪不准确",
        status="open",
        modification_scope="shot",
    )
    review.annotations.append(
        models.VisualAnnotation(
            kind="circle",
            geometry={
                "cx": 0.42,
                "cy": 0.31,
                "rx": 0.12,
                "ry": 0.08,
                "api_key": "must-not-leak",
            },
            color="#B9473E",
            label="眉眼区域",
        )
    )
    review.messages.append(
        models.VisualReviewMessage(
            author_kind="user",
            content="降低惊恐感，但不要改变脸型。",
        )
    )
    session.add_all([usage, review])
    session.commit()
    stage = DirectorStageService(session).get_or_create_stage(scene.id)
    stage.environment = {"rain": True}
    director_character = models.DirectorObject(
        stage=stage,
        kind="character",
        source_type="placeholder",
        label="林夏站位",
        position=1,
        transform={
            "position": [0, 0, 0],
            "rotation": [0, 0, 0],
            "scale": [1, 1, 1],
        },
        appearance={},
        metadata={},
        visible=True,
    )
    scene_asset = models.LibraryAsset(
        project=project,
        kind="scene",
        name="雨夜天台",
        description="湿润水泥地和霓虹护栏",
        tags=["雨夜", "天台"],
    )
    session.add_all([director_character, scene_asset])
    session.flush()
    session.add(
        models.LibraryAssetSceneBinding(library_asset=scene_asset, scene=scene)
    )
    camera = stage.shot_cameras[1]
    camera.focal_length_mm = 85
    camera.object_overrides = {
        director_character.id: {
            "transform": {
                "position": [2, 0, -1],
                "rotation": [0, math.pi / 2, 0],
                "scale": [2, 2, 2],
            },
            "pose_preset": "action",
            "facial_expression": "angry",
        }
    }
    session.commit()
    return shot, previous


@pytest.mark.anyio
async def test_prompt_suggestion_uses_bounded_trusted_context_without_mutating_shot(db_session):
    shot, previous = _graph(db_session)
    provider = FakePromptProvider()

    suggestion = await PromptSuggestionService(db_session, provider).create(
        shot.id, "panel"
    )

    assert suggestion.mode == "panel"
    assert suggestion.prompt.startswith("雨夜近景")
    assert provider.context["previous_shot"]["id"] == previous.id
    assert provider.context["characters"][0]["name"] == "林夏"
    assert provider.context["asset_usages"][0]["variant_label"] == "黑色风衣主造型"
    assert provider.context["director"]["camera"]["focal_length_mm"] == 85
    assert "object_overrides" not in provider.context["director"]["camera"]
    assert provider.context["director"]["objects"] == [
        {
            "id": provider.context["director"]["objects"][0]["id"],
            "kind": "character",
            "source_type": "placeholder",
            "source_id": None,
            "label": "林夏站位",
            "position": [2, 0, -1],
            "horizontal_facing_degrees": 90,
        }
    ]
    assert provider.context["library_assets"][0]["name"] == "雨夜天台"
    assert "scale" not in str(provider.context["director"]["objects"])
    assert "pose_preset" not in str(provider.context["director"])
    assert "facial_expression" not in str(provider.context["director"])
    assert provider.context["visual_reviews"][0]["scope"] == "shot"
    assert provider.context["visual_reviews"][0]["annotations"][0]["label"] == "眉眼区域"
    assert provider.context["visual_reviews"][0]["messages"][0]["content"] == "降低惊恐感，但不要改变脸型。"
    assert db_session.get(models.Shot, shot.id).image_prompt == "existing prompt"
    assert "api_key" not in str(provider.context).lower()


def test_generation_context_previews_the_effective_compiled_inputs(db_session):
    shot, _previous = _graph(db_session)

    context = PromptSuggestionService(db_session, None).generation_context(
        shot.id, "panel"
    )

    assert context.shot_id == shot.id
    assert context.mode == "panel"
    assert context.snapshot_hash
    assert "Director camera" in context.prompt_constraints
    assert context.library_assets[0].name == "雨夜天台"
    assert context.director is not None
    assert context.director.camera is not None
    assert context.director.camera.focal_length_mm == 85
    assert context.director.objects[0].label == "林夏站位"
    assert context.director.objects[0].position == [2, 0, -1]
    assert context.director.objects[0].horizontal_facing_degrees == 90
    assert "scale" not in context.model_dump_json()
    assert "pose_preset" not in context.model_dump_json()


def test_prompt_suggestion_route_validates_mode_and_returns_reviewable_draft(client, monkeypatch):
    from tests.test_director_api import _scene_via_client

    _scene_id, shot_id = _scene_via_client(client)
    provider = FakePromptProvider()
    monkeypatch.setattr(client.app.state.provider_factory, "create_llm", lambda: provider)

    response = client.post(
        f"/api/shots/{shot_id}/prompt-suggestion", json={"mode": "video"}
    )

    assert response.status_code == 200
    assert response.json()["mode"] == "video"
    assert response.json()["prompt"]
    assert client.post(
        f"/api/shots/{shot_id}/prompt-suggestion", json={"mode": "invalid"}
    ).status_code == 422
    context = client.get(
        f"/api/shots/{shot_id}/generation-context", params={"mode": "panel"}
    )
    assert context.status_code == 200
    assert context.json()["shot_id"] == shot_id
    assert context.json()["mode"] == "panel"

    class FailingProvider:
        async def suggest_media_prompt(self, _context):
            from comic_studio.providers.base import ProviderError

            raise ProviderError("upstream response contained private details")

    monkeypatch.setattr(
        client.app.state.provider_factory, "create_llm", lambda: FailingProvider()
    )
    failed = client.post(
        f"/api/shots/{shot_id}/prompt-suggestion", json={"mode": "panel"}
    )
    assert failed.status_code == 502
    assert failed.json() == {"detail": "Prompt suggestion failed"}


@pytest.mark.anyio
async def test_minimax_prompt_suggestion_rejects_unstructured_output(monkeypatch):
    from comic_studio.providers.base import ProviderError
    from comic_studio.providers.minimax import MiniMaxProvider

    provider = MiniMaxProvider("test-key")

    async def invalid(*_args, **_kwargs):
        return "not valid json"

    monkeypatch.setattr(provider, "_request", invalid)
    with pytest.raises(ProviderError, match="invalid media prompt suggestion"):
        await provider.suggest_media_prompt({"mode": "panel", "shot": {}})
