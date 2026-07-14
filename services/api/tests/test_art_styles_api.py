"""Tests for the /api/art-styles endpoint."""

from __future__ import annotations

import pytest

from comic_studio import models
from comic_studio.assets import AssetStore
from comic_studio.services.character_references import CharacterReferenceService
from comic_studio.services.panels import PanelService
from tests.test_character_references import PNG
from tests.test_panel_versions import FakeImageProvider


def seed_shot_with_character(session):
    project = models.Project(
        title="霓虹夜行",
        logline="侦探寻找记忆",
        story_bible="近未来重庆",
        visual_style="Chinese noir",
        aspect_ratio="9:16",
    )
    episode = models.Episode(
        project=project,
        title="雨夜",
        premise="寻找芯片",
        target_duration_seconds=60,
    )
    scene = models.Scene(
        episode=episode,
        position=1,
        location="巷道",
        summary="发现线索",
        estimated_duration_seconds=5,
    )
    shot = models.Shot(
        scene=scene,
        position=1,
        shot_type="close_up",
        duration_seconds=5,
        composition="芯片特写",
        negative_prompt="low quality",
    )
    character = models.Character(
        project_id=project.id,
        name="林夏",
        role="主角",
        appearance_bible="黑色风衣",
        personality="冷静",
        continuity_rules="耳钉",
        negative_constraints="",
        voice_speaker="v1",
    )
    session.add_all([project, episode, scene, shot])
    session.flush()  # assign project.id before creating the character
    character.project_id = project.id
    session.add(character)
    session.commit()
    shot.character_state = {character.id: {}}
    session.commit()
    return project, shot, character


def test_list_art_styles_endpoint(client):
    response = client.get("/api/art-styles")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    ids = [item["id"] for item in data["items"]]
    assert "2d_anime" in ids
    assert "watercolor" in ids


def test_get_art_style_endpoint(client):
    response = client.get("/api/art-styles/2d_anime")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == "2d_anime"
    assert "prefix" in data
    assert "negative" in data


def test_get_missing_art_style_returns_404(client):
    response = client.get("/api/art-styles/missing-style")
    assert response.status_code == 404


def test_panel_injects_character_art_style(db_session, tmp_path, monkeypatch):
    """A character's art_style_id should be injected into the panel prompt."""
    import asyncio

    project, shot, character = seed_shot_with_character(db_session)
    character.art_style_id = "watercolor"
    db_session.commit()

    reference, _asset = asyncio.run(
        CharacterReferenceService(db_session, tmp_path).generate(
            character.id,
            "primary",
            label="正面",
            provider=FakeImageProvider(),
        )
    )
    reference.review_status = "approved"
    db_session.commit()
    CharacterReferenceService(db_session, tmp_path).activate(character.id, reference.id)

    class Provider:
        model = "test-image"
        prompt: str | None = None

        async def edit(self, prompt, references, size="1024x1536", quality="auto"):
            self.prompt = prompt
            from comic_studio.providers.gpt_image import ImageResult

            return ImageResult(b"panel")

        async def generate(self, *args, **kwargs):
            raise AssertionError("must not use text-only generation")

    provider = Provider()
    asyncio.run(
        PanelService(db_session, tmp_path, provider).generate_panel(shot.id)
    )
    assert provider.prompt is not None
    assert "Watercolor painting style" in provider.prompt
    assert "3D render, photorealistic, anime cel-shading" in provider.prompt
