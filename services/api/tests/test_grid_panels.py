"""Tests for M3.1 grid panel generation service."""

import asyncio
from io import BytesIO

from PIL import Image

from comic_studio import models
from comic_studio.providers.gpt_image import ImageResult
from comic_studio.services.panels import PanelService


class FakeGridProvider:
    """Returns a deterministic 400x400 PNG so the 2x2 split yields 4 cells."""

    model = "fake-grid"

    async def generate(self, prompt, size="1024x1536", quality="auto"):
        return self._result()

    async def edit(self, prompt, references, size="1024x1536", quality="auto"):
        return self._result()

    @staticmethod
    def _result():
        buffer = BytesIO()
        Image.new("RGB", (400, 400), color=(100, 150, 200)).save(buffer, format="PNG")
        return ImageResult(buffer.getvalue(), media_type="image/png")


def seed_grid_shots(session):
    project = models.Project(
        title="Grid test",
        logline="x",
        story_bible="x",
        visual_style="comic",
        aspect_ratio="9:16",
    )
    episode = models.Episode(
        project=project,
        title="Grid episode",
        premise="x",
        target_duration_seconds=60,
    )
    scene = models.Scene(
        episode=episode,
        position=1,
        location="street",
        summary="chase",
        estimated_duration_seconds=8,
    )
    shots = [
        models.Shot(
            scene=scene,
            position=i,
            shot_type="wide",
            duration_seconds=2,
            composition=f"shot-{i}",
            image_prompt=f"prompt-{i}",
        )
        for i in range(1, 5)
    ]
    session.add_all(shots)
    session.commit()
    return project, shots


def test_generate_grid_panels_creates_assets_for_all_shots(db_session, tmp_path):
    project, shots = seed_grid_shots(db_session)
    service = PanelService(db_session, tmp_path, FakeGridProvider())

    assets = asyncio.run(service.generate_grid_panels([shot.id for shot in shots], activate=True))

    assert len(assets) == 4
    for shot, asset in zip(shots, assets):
        assert asset.kind == f"panel:{shot.id}"
        assert asset.project_id == project.id
        assert shot.active_panel_asset_id == asset.id
