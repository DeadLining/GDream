from pathlib import Path
from io import BytesIO

import pytest
from PIL import Image
from sqlalchemy import select

from comic_studio import models
from comic_studio.db import create_session_factory, create_tables
from comic_studio.model_runtime.contracts import Capability
from comic_studio.model_runtime.service import ModelRuntimeService
from comic_studio.providers.model_3d_base import Model3DResult
from comic_studio.services.character_references import CharacterReferenceService
from comic_studio.services.model_3d import (
    Model3DGenerationError,
    Model3DGenerationService,
)
from comic_studio.services.model_3d_postprocess import ProcessedModel3D
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


class RecordingMultiViewProvider:
    model = "fake-multiview-model3d"

    def __init__(self):
        self.inputs = []

    async def generate_model(self, image_bytes, media_type, filename):
        self.inputs.append((image_bytes, media_type, filename))
        return Model3DResult(_glb(), "https://models.example.com/multiview.glb")


class RecordingRegistry:
    def __init__(self):
        self.provider = RecordingMultiViewProvider()

    def create(self, capability):
        assert capability is Capability.MODEL_3D
        return self.provider


class FakePostProcessor:
    def process(self, content, thumbnail_source):
        assert content == _glb()
        assert thumbnail_source
        return ProcessedModel3D(
            content=_glb({"asset": {"version": "2.0", "generator": "optimized"}}),
            thumbnail=_png((40, 80, 160)),
            metadata={
                "tool": "gltf-transform",
                "version": "4.4.1",
                "protected_rig": False,
                "steps": ["dedup", "prune", "weld", "simplify", "texture_compress"],
                "source_bytes": len(_glb()),
                "output_bytes": len(_glb()),
                "thumbnail_width": 512,
                "thumbnail_height": 512,
            },
        )


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


def _recording_runtime(tmp_path: Path):
    session_factory = create_session_factory(f"sqlite:///{tmp_path / 'model3d.db'}")
    create_tables(session_factory)
    registry = RecordingRegistry()
    service = ModelRuntimeService(
        channel_store=None,
        session_factory=session_factory,
        data_root=tmp_path / "data",
        adapters=registry,
    )
    return service, session_factory, registry.provider


def _postprocessing_runtime(tmp_path: Path):
    session_factory = create_session_factory(f"sqlite:///{tmp_path / 'model3d.db'}")
    create_tables(session_factory)
    registry = RecordingRegistry()
    service = ModelRuntimeService(
        channel_store=None,
        session_factory=session_factory,
        data_root=tmp_path / "data",
        adapters=registry,
        model3d_postprocessor_factory=lambda _data_root: FakePostProcessor(),
    )
    return service, session_factory


def _png(color: tuple[int, int, int]) -> bytes:
    output = BytesIO()
    Image.new("RGB", (8, 8), color).save(output, format="PNG")
    return output.getvalue()


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


def _library_asset_reference(session_factory, data_root: Path) -> tuple[str, str]:
    with session_factory() as session:
        project = models.Project(
            title="3D prop generation",
            logline="Generate a prop proxy",
            story_bible="Story",
            visual_style="comic",
        )
        reference = models.Asset(
            project=project,
            kind="library-asset-reference",
            local_path="",
            media_type="image/png",
            provider="upload",
            model="local",
            request_metadata={},
            checksum="reference-checksum",
            review_status="approved",
        )
        library_asset = models.LibraryAsset(
            project=project,
            kind="prop",
            name="Pocket watch",
            description="",
            tags=[],
            asset_metadata={},
        )
        session.add_all([project, reference, library_asset])
        session.flush()
        relative = Path("projects") / project.id / "references" / f"{reference.id}.png"
        destination = data_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(PNG)
        reference.local_path = str(relative)
        library_asset.asset_metadata = {"reference_asset_id": reference.id}
        session.commit()
        return library_asset.id, reference.id


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
async def test_character_model3d_job_preserves_variant_state_scope(tmp_path):
    service, session_factory = _runtime(tmp_path)
    character_id, reference_asset_id = _character_reference(
        session_factory, service.data_root
    )
    with session_factory() as session:
        character = session.get(models.Character, character_id)
        episode = models.Episode(
            project_id=character.project_id,
            title="Episode two",
            premise="Injury continuity",
            target_duration_seconds=60,
        )
        session.add(episode)
        session.flush()
        variant = models.AssetVariant(
            character_id=character_id,
            episode_id=episode.id,
            kind="episode",
            label="Rain outfit",
            inherited_fields=["identity"],
            overrides={"outfit": "rain coat"},
        )
        state = models.AssetVariantState(
            variant=variant,
            kind="injury",
            label="Injured brow",
            overrides={"injury": "left brow"},
        )
        session.add_all([episode, variant, state])
        session.commit()
        variant_id, state_id = variant.id, state.id
    job = service.create_media_job(
        Capability.MODEL_3D,
        "character",
        character_id,
        {
            "reference_asset_id": reference_asset_id,
            "variant_id": variant_id,
            "state_id": state_id,
        },
    )

    await service.run_media_job(job.id)

    succeeded = service.get_job(job.id)
    with session_factory() as session:
        representation = session.get(
            models.Character3DRepresentation,
            succeeded.result_metadata["representation_id"],
        )
        assert representation.variant_id == variant_id
        assert representation.state_id == state_id
        assert representation.asset.request_metadata["variant_id"] == variant_id
        assert representation.asset.request_metadata["state_id"] == state_id


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


@pytest.mark.anyio
async def test_character_model3d_composes_approved_multi_view_references(tmp_path):
    service, session_factory, provider = _recording_runtime(tmp_path)
    character_id, primary_asset_id = _character_reference(
        session_factory, service.data_root
    )
    with session_factory() as session:
        references = CharacterReferenceService(session, service.data_root)
        view_asset_ids = []
        for reference_type, color in zip(
            ("three_quarter", "side", "back"),
            ((220, 20, 20), (20, 180, 20), (20, 20, 220)),
        ):
            reference, asset = references.upload(
                character_id,
                _png(color),
                reference_type,
                reference_type,
            )
            reference.review_status = "approved"
            view_asset_ids.append(asset.id)
        session.commit()

    job = service.create_media_job(
        Capability.MODEL_3D,
        "character",
        character_id,
        {
            "reference_asset_id": primary_asset_id,
            "reference_asset_ids": [
                view_asset_ids[1],
                primary_asset_id,
                view_asset_ids[2],
                view_asset_ids[0],
            ],
        },
    )

    await service.run_media_job(job.id)

    succeeded = service.get_job(job.id)
    assert succeeded.status == "succeeded"
    assert len(provider.inputs) == 1
    content, media_type, filename = provider.inputs[0]
    assert media_type == "image/png"
    assert filename == "character-multi-view.png"
    with Image.open(BytesIO(content)) as image:
        assert image.size == (1024, 1536)
        assert image.mode == "RGB"
        assert image.getpixel((768, 384)) == (220, 20, 20)
        assert image.getpixel((256, 1152)) == (20, 180, 20)
        assert image.getpixel((768, 1152)) == (20, 20, 220)
    with session_factory() as session:
        representation = session.get(
            models.Character3DRepresentation,
            succeeded.result_metadata["representation_id"],
        )
        metadata = representation.asset.request_metadata
        assert metadata["reference_asset_ids"] == [
            primary_asset_id,
            view_asset_ids[0],
            view_asset_ids[1],
            view_asset_ids[2],
        ]
        assert metadata["reference_types"] == [
            "primary",
            "three_quarter",
            "side",
            "back",
        ]
        assert metadata["reference_input_mode"] == "multi_view_contact_sheet"
        assert len(metadata["reference_input_checksum"]) == 64


@pytest.mark.anyio
async def test_character_model3d_rejects_unapproved_reference_in_multi_view_set(
    tmp_path,
):
    service, session_factory, _provider = _recording_runtime(tmp_path)
    character_id, primary_asset_id = _character_reference(
        session_factory, service.data_root
    )
    with session_factory() as session:
        _reference, draft_asset = CharacterReferenceService(
            session, service.data_root
        ).upload(character_id, PNG, "side", "Draft side")

    with pytest.raises(
        Model3DGenerationError,
        match="approved_character_references_required",
    ):
        await service.execute_model3d(
            "character",
            character_id,
            primary_asset_id,
            reference_asset_ids=[primary_asset_id, draft_asset.id],
        )


@pytest.mark.anyio
async def test_character_model3d_persists_processed_model_and_thumbnail(tmp_path):
    service, session_factory = _postprocessing_runtime(tmp_path)
    character_id, reference_asset_id = _character_reference(
        session_factory, service.data_root
    )

    result = await service.execute_model3d(
        "character",
        character_id,
        reference_asset_id,
    )

    with session_factory() as session:
        representation = session.get(
            models.Character3DRepresentation,
            result["representation_id"],
        )
        model_path = service.data_root / representation.asset.local_path
        assert b'"generator":"optimized"' in model_path.read_bytes()
        postprocess = representation.asset.request_metadata["postprocess"]
        assert postprocess["tool"] == "gltf-transform"
        thumbnail_url = representation.representation_metadata["thumbnail_url"]
        assert thumbnail_url.endswith(f"/{representation.asset_id}.png")
        thumbnail_path = service.data_root / thumbnail_url.removeprefix("/media/")
        assert thumbnail_path.is_file()
        with Image.open(thumbnail_path) as thumbnail:
            assert thumbnail.size == (512, 512)


@pytest.mark.anyio
async def test_library_model3d_persists_processed_candidate_thumbnail_on_approval(
    tmp_path,
):
    service, session_factory = _postprocessing_runtime(tmp_path)
    library_asset_id, reference_asset_id = _library_asset_reference(
        session_factory,
        service.data_root,
    )

    result = await service.execute_model3d(
        "library_asset",
        library_asset_id,
        reference_asset_id,
    )

    with session_factory() as session:
        candidate = session.get(models.Asset, result["asset_id"])
        model_path = service.data_root / candidate.local_path
        assert b'"generator":"optimized"' in model_path.read_bytes()
        postprocess = candidate.request_metadata["postprocess"]
        assert postprocess["tool"] == "gltf-transform"
        thumbnail_url = candidate.request_metadata["thumbnail_url"]
        assert thumbnail_url.endswith(f"/{candidate.id}.png")
        thumbnail_path = service.data_root / thumbnail_url.removeprefix("/media/")
        assert thumbnail_path.is_file()

        Model3DGenerationService.approve(
            session,
            "library_asset",
            library_asset_id,
            result,
        )
        library_asset = session.get(models.LibraryAsset, library_asset_id)
        assert library_asset.asset_metadata["model3d_thumbnail_url"] == thumbnail_url
        assert library_asset.asset_metadata["model3d_postprocess"] == postprocess
