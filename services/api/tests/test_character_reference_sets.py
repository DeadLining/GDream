import pytest

from comic_studio import models
from comic_studio.providers.base import ProviderError
from comic_studio.providers.base import ProviderHTTPError
from comic_studio.providers.gpt_image import ImageResult
from comic_studio.services.character_reference_sets import (
    REFERENCE_SET_TYPES,
    CharacterReferenceSetError,
    CharacterReferenceSetService,
)
from tests.test_character_references import PNG


class FakeImageProvider:
    model = "gpt-image-2"

    def __init__(self):
        self.generate_calls = []
        self.edit_calls = []
        self.fail_on = None
        self.reject_reused_anchor_once = False

    async def generate(self, prompt, size="1024x1536", quality="auto"):
        self.generate_calls.append((prompt, size, quality))
        return ImageResult(PNG)

    async def edit(
        self,
        prompt,
        references,
        size="1024x1536",
        quality="auto",
    ):
        reference_type = next(
            item for item in REFERENCE_SET_TYPES if f"Reference view: {item}." in prompt
        )
        self.edit_calls.append((reference_type, references, size, quality, prompt))
        if self.reject_reused_anchor_once:
            self.reject_reused_anchor_once = False
            raise ProviderHTTPError(400, "GPT Image HTTP 400: protected character")
        if reference_type == self.fail_on:
            raise ProviderError(f"failed {reference_type}")
        return ImageResult(PNG)


def character(db_session):
    project = models.Project(
        title="Project",
        logline="Logline",
        story_bible="Story",
        visual_style="Comic",
    )
    db_session.add(project)
    db_session.flush()
    item = models.Character(
        project_id=project.id,
        name="Lin Xia",
        role="Lead",
        appearance_bible="short black hair and a teal jacket",
        personality="calm",
        continuity_rules="silver earring on the left ear",
        negative_constraints="no hat",
        voice_speaker="v1",
    )
    db_session.add(item)
    db_session.commit()
    return item


@pytest.mark.anyio
async def test_set_generation_creates_one_anchor_and_edits_every_variant(
    db_session, tmp_path
):
    item = character(db_session)
    provider = FakeImageProvider()
    snapshots = []

    async def progress(snapshot):
        snapshots.append(snapshot)

    result = await CharacterReferenceSetService(db_session, tmp_path).generate(
        item.id,
        provider,
        on_progress=progress,
        resume={},
    )

    assert len(provider.generate_calls) == 1
    assert [call[0] for call in provider.edit_calls] == list(REFERENCE_SET_TYPES[1:])
    assert all(call[2:] and call[2] == "768x1024" for call in provider.edit_calls)
    assert all(call[3] == "low" for call in provider.edit_calls)
    assert len({call[1][0][0] for call in provider.edit_calls}) == 1
    assert result["completed_types"] == list(REFERENCE_SET_TYPES)
    assert result["current_type"] is None
    assert snapshots[-1]["current_index"] == 7

    primary = db_session.get(
        models.CharacterReference,
        result["references"]["primary"]["reference_id"],
    )
    assert primary.review_status == "approved"
    assert primary.is_active is True


@pytest.mark.anyio
async def test_set_generation_reuses_existing_approved_active_anchor(
    db_session, tmp_path
):
    item = character(db_session)
    service = CharacterReferenceSetService(db_session, tmp_path)
    reference, asset = service.references.upload(item.id, PNG, "primary")
    service.references.approve_and_activate(item.id, reference.id)
    provider = FakeImageProvider()

    async def progress(_snapshot):
        return None

    result = await service.generate(
        item.id, provider, on_progress=progress, resume={}
    )

    assert provider.generate_calls == []
    assert result["references"]["primary"] == {
        "reference_id": reference.id,
        "asset_id": asset.id,
        "reused": True,
    }


@pytest.mark.anyio
async def test_set_generation_replaces_an_uneditable_reused_anchor_once(
    db_session, tmp_path
):
    item = character(db_session)
    service = CharacterReferenceSetService(db_session, tmp_path)
    reference, _asset = service.references.upload(item.id, PNG, "primary")
    service.references.approve_and_activate(item.id, reference.id)
    provider = FakeImageProvider()
    provider.reject_reused_anchor_once = True

    async def progress(_snapshot):
        return None

    result = await service.generate(
        item.id, provider, on_progress=progress, resume={}
    )

    assert len(provider.generate_calls) == 1
    assert result["references"]["primary"].get("reused") is None
    assert result["references"]["primary"]["reference_id"] != reference.id
    assert result["completed_types"] == list(REFERENCE_SET_TYPES)


@pytest.mark.anyio
async def test_set_generation_preserves_partial_results_and_resume_skips_them(
    db_session, tmp_path
):
    item = character(db_session)
    provider = FakeImageProvider()
    provider.fail_on = "side"
    service = CharacterReferenceSetService(db_session, tmp_path)

    async def progress(_snapshot):
        return None

    with pytest.raises(CharacterReferenceSetError) as raised:
        await service.generate(item.id, provider, on_progress=progress, resume={})

    metadata = raised.value.metadata
    assert metadata["completed_types"] == ["primary", "front", "three_quarter"]
    assert metadata["failed_type"] == "side"
    completed_calls = len(provider.edit_calls)

    provider.fail_on = None
    result = await service.generate(
        item.id,
        provider,
        on_progress=progress,
        resume=metadata,
    )

    assert result["completed_types"] == list(REFERENCE_SET_TYPES)
    assert [call[0] for call in provider.edit_calls[completed_calls:]] == [
        "side",
        "back",
        "expression",
        "outfit",
    ]
