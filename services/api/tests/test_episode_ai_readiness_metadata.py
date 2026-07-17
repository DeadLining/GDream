import asyncio

import pytest

from comic_studio import models
from comic_studio.services.episode_ai_orchestrator import EpisodeAIStageNeedsReview
from comic_studio.services.episode_ai_stage_handlers import EpisodeAIStageHandlers
from tests.test_episode_ai_stage_handlers import FakeImageRuntime, _context, _seed_episode


def test_panel_stage_exposes_structured_generation_readiness(tmp_path):
    session_factory, data_root, episode_id, _character_id, shot_id, _dialogue_id = (
        _seed_episode(tmp_path)
    )
    with session_factory() as session:
        episode = session.get(models.Episode, episode_id)
        document = models.ScriptDocument(
            project_id=episode.project_id,
            title="Structured readiness script",
            source_type="upload",
            status="ready",
        )
        session.add(document)
        session.flush()
        revision = models.ScriptRevision(
            document_id=document.id,
            revision_number=1,
            status="finalized",
            content="林夏在旧车站发现线索。",
            checksum="structured-readiness-script",
            creation_method="upload",
        )
        session.add(revision)
        session.flush()
        document.current_revision_id = revision.id
        session.commit()

    handlers = EpisodeAIStageHandlers(
        session_factory,
        data_root,
        FakeImageRuntime(session_factory, data_root),
    )

    with pytest.raises(EpisodeAIStageNeedsReview) as raised:
        asyncio.run(handlers.panels(_context(episode_id, "panels")))

    assert str(raised.value) == "Shot generation is not ready"
    blocked = raised.value.metadata["blocked_shots"][shot_id]
    assert blocked["blockers"] == [
        "missing_character_reference",
        "missing_background",
        "blocking_not_initialized",
        "director_preview_missing",
    ]
    assert len(blocked["requirement_ids"]) == 2
