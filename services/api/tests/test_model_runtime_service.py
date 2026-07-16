from pathlib import Path

import pytest

from comic_studio import models
from comic_studio.db import create_session_factory, create_tables
from comic_studio.model_runtime.contracts import Capability, TextStreamRequest
from comic_studio.model_runtime.errors import ModelRuntimeError, RuntimeErrorCode
from comic_studio.model_runtime.service import ModelRuntimeService
from comic_studio.providers.gpt_image import ImageResult
from tests.test_character_references import PNG


class FakeTextAdapter:
    model = "fake-text"

    def __init__(self, chunks=None, error=None):
        self.chunks = chunks or []
        self.error = error
        self.suggestion_context = None
        self.chapter_context = None

    async def stream_script(self, _context):
        if self.error:
            raise self.error
        for chunk in self.chunks:
            yield chunk

    async def suggest_asset_variant(self, context):
        self.suggestion_context = context
        return {
            "kind": "state",
            "label": "左臂擦伤",
            "summary": "局部伤势变化",
            "inherited_fields": ["identity"],
            "overrides": {"injury": "left-arm"},
            "state_kind": "injury",
            "assistant_message": "建议创建为伤势状态。",
        }

    async def extract_chapter_events(self, context):
        self.chapter_context = context
        return {
            "chapter_index": context["chapter_index"],
            "title": context.get("chapter_title") or None,
            "beats": [],
            "conflicts": [],
            "open_threads": [],
            "payoff_candidates": [],
            "character_mentions": [],
        }


class FakeRegistry:
    def __init__(self, adapter):
        self.adapter = adapter

    def create(self, capability):
        assert capability is Capability.TEXT
        return self.adapter


def runtime(tmp_path: Path, adapter: FakeTextAdapter) -> ModelRuntimeService:
    session_factory = create_session_factory(f"sqlite:///{tmp_path / 'runtime.db'}")
    create_tables(session_factory)
    return ModelRuntimeService(
        channel_store=None,
        session_factory=session_factory,
        data_root=tmp_path,
        adapters=FakeRegistry(adapter),
    )


@pytest.mark.anyio
async def test_stream_text_uses_registered_text_adapter(tmp_path):
    service = runtime(tmp_path, FakeTextAdapter(chunks=["A", "B"]))
    request = TextStreamRequest(purpose="script_generation", context={})

    assert [chunk async for chunk in service.stream_text(request)] == ["A", "B"]
    assert service.list_invocations(10)[0].status == "succeeded"


@pytest.mark.anyio
async def test_stream_failure_is_classified_and_persisted(tmp_path):
    service = runtime(tmp_path, FakeTextAdapter(error=TimeoutError("secret")))
    request = TextStreamRequest(purpose="script_generation", context={})

    with pytest.raises(ModelRuntimeError) as raised:
        [chunk async for chunk in service.stream_text(request)]

    assert raised.value.code is RuntimeErrorCode.PROVIDER_TIMEOUT
    invocation = service.list_invocations(10)[0]
    assert invocation.error_code == "provider_timeout"
    assert invocation.retryable is True


@pytest.mark.anyio
async def test_asset_variant_suggestion_uses_the_registered_text_adapter(tmp_path):
    adapter = FakeTextAdapter()
    service = runtime(tmp_path, adapter)

    result = await service.suggest_asset_variant({"message": "挨打后左臂擦伤"})

    assert result["kind"] == "state"
    assert result["state_kind"] == "injury"
    assert adapter.suggestion_context == {"message": "挨打后左臂擦伤"}
    assert service.list_invocations(10)[0].status == "succeeded"


@pytest.mark.anyio
async def test_chapter_event_extraction_uses_registered_text_adapter(tmp_path):
    adapter = FakeTextAdapter()
    service = runtime(tmp_path, adapter)
    context = {
        "chapter_index": 2,
        "chapter_title": "反转",
        "chapter_text": "真相浮出水面。",
    }

    result = await service.extract_chapter_events(context)

    assert result["chapter_index"] == 2
    assert adapter.chapter_context == context
    invocation = service.list_invocations(10)[0]
    assert invocation.status == "succeeded"
    assert invocation.target_type == "script_chapter"


class FakeImageAdapter:
    model = "gpt-image-2"

    def __init__(self):
        self.fail_side = True

    async def generate(self, _prompt, size="1024x1536", quality="auto"):
        return ImageResult(PNG)

    async def edit(
        self, prompt, _references, size="1024x1536", quality="auto"
    ):
        if self.fail_side and "Reference view: side." in prompt:
            raise TimeoutError("provider secret timeout detail")
        return ImageResult(PNG)


class FakeImageRegistry:
    def __init__(self, adapter):
        self.adapter = adapter

    def create(self, capability):
        assert capability is Capability.IMAGE
        return self.adapter


def image_runtime(tmp_path):
    session_factory = create_session_factory(f"sqlite:///{tmp_path / 'image.db'}")
    create_tables(session_factory)
    adapter = FakeImageAdapter()
    service = ModelRuntimeService(
        channel_store=None,
        session_factory=session_factory,
        data_root=tmp_path / "data",
        adapters=FakeImageRegistry(adapter),
    )
    with session_factory() as session:
        project = models.Project(
            title="Project",
            logline="Logline",
            story_bible="Story",
            visual_style="Comic",
        )
        session.add(project)
        session.flush()
        character = models.Character(
            project_id=project.id,
            name="Lin Xia",
            role="Lead",
            appearance_bible="black hair and teal jacket",
            personality="calm",
            continuity_rules="silver earring",
            negative_constraints="no hat",
            voice_speaker="v1",
        )
        session.add(character)
        session.commit()
        character_id = character.id
    return service, adapter, character_id


@pytest.mark.anyio
async def test_reference_set_job_persists_partial_progress_and_resumes(tmp_path):
    service, adapter, character_id = image_runtime(tmp_path)
    job = service.create_media_job(
        Capability.IMAGE,
        "character",
        character_id,
        {"mode": "reference_set", "activate": True},
    )

    await service.run_media_job(job.id)

    failed = service.get_job(job.id)
    assert failed.status == "failed"
    assert failed.result_metadata["completed_types"] == [
        "primary",
        "front",
        "three_quarter",
    ]
    assert failed.result_metadata["failed_type"] == "side"
    assert failed.result_metadata["error_code"] == "provider_timeout"
    assert failed.result_metadata["provider_error"] == "provider secret timeout detail"

    adapter.fail_side = False
    retried = service.retry_job(job.id)
    assert retried.result_metadata["completed_types"][-1] == "three_quarter"
    await service.run_media_job(job.id)

    succeeded = service.get_job(job.id)
    assert succeeded.status == "succeeded"
    assert succeeded.result_metadata["completed_types"] == [
        "primary",
        "front",
        "three_quarter",
        "side",
        "back",
        "expression",
        "outfit",
    ]
