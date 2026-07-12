from hashlib import sha256

import pytest
from sqlalchemy.exc import IntegrityError

from comic_studio import models


def _project(session) -> models.Project:
    project = models.Project(
        title="雨夜追踪",
        logline="追查失窃芯片",
        story_bible="主角必须在黎明前找到芯片。",
        visual_style="现代都市动态漫画",
    )
    session.add(project)
    session.flush()
    return project


def test_script_document_owns_numbered_revisions(db_session):
    project = _project(db_session)
    document = models.ScriptDocument(
        project_id=project.id,
        title="第一版剧本",
        source_type="ai",
    )
    db_session.add(document)
    db_session.flush()
    revision = models.ScriptRevision(
        document_id=document.id,
        revision_number=1,
        status="working",
        content="第一集：雨夜",
        checksum=sha256("第一集：雨夜".encode()).hexdigest(),
        creation_method="ai",
    )
    db_session.add(revision)
    db_session.flush()
    document.current_revision_id = revision.id
    db_session.commit()

    assert project.scripts == [document]
    assert document.revisions == [revision]
    assert document.current_revision_id == revision.id


def test_script_document_allows_only_one_working_revision(db_session):
    project = _project(db_session)
    document = models.ScriptDocument(
        project_id=project.id,
        title="冲突测试",
        source_type="paste",
    )
    db_session.add(document)
    db_session.flush()
    db_session.add_all(
        [
            models.ScriptRevision(
                document_id=document.id,
                revision_number=1,
                status="working",
                content="版本一",
                checksum=sha256("版本一".encode()).hexdigest(),
                creation_method="paste",
            ),
            models.ScriptRevision(
                document_id=document.id,
                revision_number=2,
                status="working",
                content="版本二",
                checksum=sha256("版本二".encode()).hexdigest(),
                creation_method="edit",
            ),
        ]
    )

    with pytest.raises(IntegrityError):
        db_session.commit()


def test_script_import_episode_links_confirmed_episode_to_revision(db_session):
    project = _project(db_session)
    document = models.ScriptDocument(
        project_id=project.id,
        title="来源追踪",
        source_type="upload",
    )
    db_session.add(document)
    db_session.flush()
    revision = models.ScriptRevision(
        document_id=document.id,
        revision_number=1,
        status="finalized",
        content="第一集",
        checksum=sha256("第一集".encode()).hexdigest(),
        creation_method="upload",
    )
    db_session.add(revision)
    db_session.flush()
    document.current_revision_id = revision.id
    script_import = models.ScriptImport(
        project_id=project.id,
        script_revision_id=revision.id,
        status="applied",
        mode="auto",
        source_format="txt",
        original_filename="story.txt",
        checksum=revision.checksum,
        extracted_text=revision.content,
    )
    episode = models.Episode(
        project_id=project.id,
        title="第一集",
        premise="雨夜追踪",
        target_duration_seconds=60,
    )
    db_session.add_all([script_import, episode])
    db_session.flush()
    link = models.ScriptImportEpisode(
        script_import_id=script_import.id,
        episode_id=episode.id,
        draft_episode_id="episode-1",
    )
    db_session.add(link)
    db_session.commit()

    assert script_import.script_revision == revision
    assert script_import.generated_episodes == [link]
    assert link.episode == episode

