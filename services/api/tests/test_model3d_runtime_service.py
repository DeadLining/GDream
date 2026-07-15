from pathlib import Path

import pytest
from sqlalchemy import select

from comic_studio import models
from comic_studio.db import create_session_factory, create_tables
from comic_studio.model_runtime.contracts import Capability
from comic_studio.model_runtime.service import ModelRuntimeService
from comic_studio.providers.model_3d_base import Model3DResult
from comic_studio.services.character_references import CharacterReferenceService
from comic_studio.services.model_3d import Model3DGenerationError
from tests.test_character_3d_representations import _glb
from tests.test_character_references import PNG


class FakeModel3DProvider:
    model = "fake-model3d"

    async def generate_model(self, image_bytes, media_type, filename):
        assert image_bytes == PNG
        assert media_type == "image/png"
        assert filename.endswith(".png")
        return Model3DResult(_glb(), "https://models.example.com/result.glb")


class FakeRegistry:
    def __init__(self):
        self.provider = FakeModel3DProvider()

    def create(self, capability):
        assert capability is Capability.MODEL_3D
        return self.provider


def _runtime(tmp_path: Path):
    session_factory = create_session_factory(f"sqlite:///{tmp_path / 'model3d.db'}")
    create_tables(session_factory)
    service = ModelRuntimeService(
        channel_store=None,
        session_factory=session_factory,
        data_root=tmp_path / "data",
        adapters=FakeRegistry(),
    )
    return service, session_factory


def _character_reference(session_factory, data_root: Path) -> tuple[str, str]:
    with session_factory() as session:
        project = models.Project(
            title="3D generation",
            logline="Generate a director proxy",
            story_bible="Story",
            visual_style="comic",
        )
        character = models.Character(
            project=project,
            name="Lin Xia",
            role="Lead",
            appearance_bible="teal jacket",
            personality="calm",
            continuity_rules="same face",
            voice_speaker="v1",
        )
        session.add(project)
        session.commit()
        reference, asset = CharacterReferenceService(session, data_root).upload(
            character.id,
            PNG,
            "primary",
            "Primary",
        )
        reference.review_status = "approved"
        reference.is_active = True
        session.commit()
        return character.id, asset.id


@pytest.mark.anyio
async def test_character_model3d_job_creates_candidate_then_requires_approval(tmp_path):
    service, session_factory = _runtime(tmp_path)
    character_id, reference_asset_id = _character_reference(
        session_factory, service.data_root
    )
    job = service.create_media_job(
        Capability.MODEL_3D,
        "character",
        character_id,
        {"reference_asset_id": reference_asset_id},
    )

    await service.run_media_job(job.id)

    succeeded = service.get_job(job.id)
    assert succeeded.status == "succeeded"
    assert succeeded.result_metadata["model_url"].endswith(".glb")
    with session_factory() as session:
        representation = session.get(
            models.Character3DRepresentation,
            succeeded.result_metadata["representation_id"],
        )
        assert representation.review_status == "draft"
        assert representation.is_active is False

    approved = service.approve_model3d_job(job.id)

    assert approved["review_status"] == "approved"
    assert approved["is_active"] is True
    with session_factory() as session:
        representation = session.get(
            models.Character3DRepresentation,
            succeeded.result_metadata["representation_id"],
        )
        assert representation.review_status == "approved"
        assert representation.is_active is True


@pytest.mark.anyio
async def test_character_model3d_rejects_an_unapproved_explicit_reference(tmp_path):
    service, session_factory = _runtime(tmp_path)
    character_id, reference_asset_id = _character_reference(
        session_factory, service.data_root
    )
    with session_factory() as session:
        reference = session.scalar(
            select(models.CharacterReference).where(
                models.CharacterReference.asset_id == reference_asset_id
            )
        )
        reference.review_status = "draft"
        reference.is_active = False
        session.commit()

    with pytest.raises(Model3DGenerationError, match="approved_character_reference_required"):
        await service.execute_model3d(
            "character",
            character_id,
            reference_asset_id,
        )
