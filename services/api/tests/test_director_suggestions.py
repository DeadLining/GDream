from __future__ import annotations

import pytest

from comic_studio import models
from comic_studio.director import DirectorSuggestionPatch
from comic_studio.services.director_stages import DirectorStageService
from comic_studio.services.director_suggestions import DirectorSuggestionService


class FakeDirectorProvider:
    def __init__(self):
        self.context = None

    async def suggest_director(self, context):
        self.context = context
        return DirectorSuggestionPatch(
            camera={"focal_length_mm": 85, "camera_motion": "push_in"},
            composition="低机位双人对峙，前景雨水形成纵深",
            camera_motion="push_in",
            image_prompt="low angle confrontation in heavy rain",
            negative_prompt="flat lighting",
            rationale="强化压迫感",
            warnings=[],
        )


def _graph(session):
    project = models.Project(
        title="雨夜",
        logline="追查",
        story_bible="记忆可交易",
        visual_style="中国黑色漫画",
    )
    character = models.Character(
        project=project,
        name="林夏",
        role="主角",
        appearance_bible="黑色风衣",
        personality="冷静",
        continuity_rules="银色耳钉",
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
        summary="雨夜对峙",
        continuity_state={"weather": "rain"},
        estimated_duration_seconds=10,
    )
    shot = models.Shot(
        scene=scene,
        position=1,
        shot_type="medium",
        duration_seconds=5,
        composition="平视双人构图",
        camera_motion="static",
        image_prompt="original prompt",
        negative_prompt="original negative",
        active_panel_asset_id="panel-keep",
        active_video_asset_id="video-keep",
    )
    session.add_all([project, character])
    session.commit()
    stage = DirectorStageService(session).get_or_create_stage(scene.id)
    return stage, shot, character


@pytest.mark.anyio
async def test_create_suggestion_uses_trusted_context_without_mutating_canonical_state(
    db_session,
):
    stage, shot, character = _graph(db_session)
    provider = FakeDirectorProvider()

    suggestion = await DirectorSuggestionService(db_session, provider).create(
        stage.id, shot.id, "shot_composition"
    )

    assert suggestion.status == "ready"
    assert suggestion.suggested_patch["composition"].startswith("低机位")
    assert provider.context["project"]["title"] == "雨夜"
    assert provider.context["characters"][0]["id"] == character.id
    assert provider.context["shot"]["id"] == shot.id
    assert "api_key" not in str(suggestion.request_context).lower()
    assert db_session.get(models.Shot, shot.id).composition == "平视双人构图"
    assert stage.shot_cameras[0].focal_length_mm == 50


@pytest.mark.anyio
async def test_create_suggestion_rejects_unknown_object_identifiers(db_session):
    stage, shot, _character = _graph(db_session)

    class InvalidProvider:
        async def suggest_director(self, context):
            return DirectorSuggestionPatch(
                object_patches=[
                    {"object_id": "unknown", "transform": {"position": [0, 0, 0]}}
                ],
                rationale="invalid",
            )

    with pytest.raises(ValueError, match="unknown_director_object"):
        await DirectorSuggestionService(db_session, InvalidProvider()).create(
            stage.id, shot.id, "stage_layout"
        )

    assert db_session.query(models.DirectorSuggestion).count() == 0


@pytest.mark.anyio
async def test_apply_to_shot_updates_only_selected_fields_and_preserves_assets(db_session):
    stage, shot, _character = _graph(db_session)
    suggestion = await DirectorSuggestionService(
        db_session, FakeDirectorProvider()
    ).create(stage.id, shot.id, "shot_composition")

    updated = DirectorSuggestionService(db_session, None).apply_to_shot(
        suggestion.id, {"composition", "camera_motion"}
    )

    assert updated.composition.startswith("低机位")
    assert updated.camera_motion == "push_in"
    assert updated.image_prompt == "original prompt"
    assert updated.negative_prompt == "original negative"
    assert updated.active_panel_asset_id == "panel-keep"
    assert updated.active_video_asset_id == "video-keep"
    assert suggestion.applied_at is not None
    assert stage.revisions[-1].reason == "shot_apply"


def test_apply_to_shot_rejects_unsupported_or_empty_fields(db_session):
    stage, shot, _character = _graph(db_session)
    suggestion = models.DirectorSuggestion(
        stage_id=stage.id,
        shot_id=shot.id,
        kind="shot_composition",
        status="ready",
        request_context={},
        suggested_patch={"composition": "new"},
    )
    db_session.add(suggestion)
    db_session.commit()

    service = DirectorSuggestionService(db_session, None)
    with pytest.raises(ValueError, match="invalid_apply_fields"):
        service.apply_to_shot(suggestion.id, {"active_panel_asset_id"})
    with pytest.raises(ValueError, match="invalid_apply_fields"):
        service.apply_to_shot(suggestion.id, set())


def test_suggestion_routes_create_draft_and_apply_selected_fields(client, monkeypatch):
    from tests.test_director_api import _scene_via_client

    scene_id, shot_id = _scene_via_client(client)
    stage = client.post(f"/api/scenes/{scene_id}/director-stage").json()
    provider = FakeDirectorProvider()
    monkeypatch.setattr(
        client.app.state.provider_factory, "create_llm", lambda: provider
    )

    created = client.post(
        f"/api/director-stages/{stage['id']}/suggestions",
        json={"shot_id": shot_id, "kind": "shot_composition"},
    )

    assert created.status_code == 201
    assert created.json()["status"] == "ready"
    assert created.json()["suggested_patch"]["composition"].startswith("低机位")

    applied = client.post(
        f"/api/director-stages/{stage['id']}/shots/{shot_id}/apply-to-shot",
        json={
            "suggestion_id": created.json()["id"],
            "fields": ["composition"],
        },
    )

    assert applied.status_code == 200
    assert applied.json()["composition"].startswith("低机位")
    assert applied.json()["camera_motion"] == "push_in"
