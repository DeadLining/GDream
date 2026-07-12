from hashlib import sha256

import pytest
from sqlalchemy.exc import IntegrityError

from comic_studio import models
from comic_studio.services.script_documents import (
    ScriptDocumentHasEpisodes,
    ScriptDocumentService,
    ScriptRevisionConflict,
)
from comic_studio.services.script_files import ScriptFileStore


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


def _project_via_api(client) -> dict:
    return client.post(
        "/api/projects",
        json={
            "title": "雨夜追踪",
            "logline": "追查失窃芯片",
            "story_bible": "主角必须在黎明前找到芯片。",
            "visual_style": "现代都市动态漫画",
            "aspect_ratio": "9:16",
        },
    ).json()


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


def test_script_document_service_creates_and_lists_latest_first(db_session):
    project = _project(db_session)
    service = ScriptDocumentService(db_session)

    first = service.create(project.id, "第一份", "paste", "第一集", "paste")
    second = service.create(project.id, "第二份", "ai", "第二集", "ai")

    assert [item.id for item in service.list_for_project(project.id)] == [
        second.id,
        first.id,
    ]
    assert second.current_revision_id is not None
    assert second.revisions[0].status == "working"


def test_script_document_service_saves_with_optimistic_checksum(db_session):
    project = _project(db_session)
    service = ScriptDocumentService(db_session)
    document = service.create(project.id, "剧本", "paste", "第一集", "paste")
    revision = document.revisions[0]
    original_checksum = revision.checksum

    saved = service.save(document.id, "第一集\n场景一", original_checksum)

    assert saved.content == "第一集\n场景一"
    assert saved.checksum == sha256(saved.content.encode()).hexdigest()
    with pytest.raises(ScriptRevisionConflict) as error:
        service.save(document.id, "过期写入", original_checksum)
    assert error.value.latest_checksum == saved.checksum


def test_script_document_service_finalizes_then_starts_next_revision(db_session):
    project = _project(db_session)
    service = ScriptDocumentService(db_session)
    document = service.create(project.id, "剧本", "paste", "第一集", "paste")

    finalized = service.finalize(document.id)
    next_revision = service.save(document.id, "第二版", finalized.checksum)

    assert finalized.status == "finalized"
    assert next_revision.status == "working"
    assert next_revision.revision_number == 2
    assert document.current_revision_id == next_revision.id


def test_script_document_service_restores_as_new_finalized_revision(db_session):
    project = _project(db_session)
    service = ScriptDocumentService(db_session)
    document = service.create(project.id, "剧本", "paste", "第一版", "paste")
    first = service.finalize(document.id)
    working = service.save(document.id, "第二版", first.checksum)
    service.finalize(document.id)

    restored = service.restore(document.id, first.id)

    assert restored.content == "第一版"
    assert restored.status == "finalized"
    assert restored.creation_method == "restore"
    assert restored.revision_number == working.revision_number + 1
    assert document.current_revision_id == restored.id


def test_script_document_service_renames_document(db_session):
    project = _project(db_session)
    service = ScriptDocumentService(db_session)
    document = service.create(project.id, "旧标题", "paste", "正文", "paste")

    renamed = service.rename(document.id, " 新标题 ")

    assert renamed.title == "新标题"


def test_script_document_service_blocks_delete_when_episode_uses_script(db_session):
    project = _project(db_session)
    service = ScriptDocumentService(db_session)
    document = service.create(project.id, "来源", "paste", "正文", "paste")
    revision = service.finalize(document.id)
    script_import = models.ScriptImport(
        project_id=project.id,
        script_revision_id=revision.id,
        status="applied",
        mode="auto",
        source_format="paste",
        checksum=revision.checksum,
        extracted_text=revision.content,
    )
    episode = models.Episode(
        project_id=project.id,
        title="第一集",
        premise="来源测试",
        target_duration_seconds=60,
    )
    db_session.add_all([script_import, episode])
    db_session.flush()
    db_session.add(models.ScriptImportEpisode(
        script_import_id=script_import.id,
        episode_id=episode.id,
        draft_episode_id="episode-1",
    ))
    db_session.commit()

    with pytest.raises(ScriptDocumentHasEpisodes) as error:
        service.delete(document.id)

    assert error.value.episodes == [(episode.id, "第一集")]
    assert db_session.get(models.ScriptDocument, document.id) is not None


def test_script_document_service_deletes_unreferenced_document_and_upload(
    db_session, tmp_path
):
    project = _project(db_session)
    file_store = ScriptFileStore(tmp_path)
    service = ScriptDocumentService(db_session, file_store)
    document = service.create(project.id, "上传", "upload", "正文", "upload")
    saved = file_store.persist_upload(project.id, document.id, "story.txt", b"story")
    revision = document.revisions[0]
    revision.source_file_path = saved.relative_path
    db_session.commit()

    service.delete(document.id)

    assert db_session.get(models.ScriptDocument, document.id) is None
    assert not (tmp_path / saved.relative_path).exists()


def test_script_document_routes_create_list_save_restore_and_delete(client):
    project = _project_via_api(client)
    created_response = client.post(
        f"/api/projects/{project['id']}/scripts",
        json={
            "title": "雨夜",
            "source_type": "paste",
            "content": "第一集",
        },
    )
    assert created_response.status_code == 201
    created = created_response.json()
    script_id = created["id"]
    original_revision = created["current_revision"]

    listed = client.get(f"/api/projects/{project['id']}/scripts")
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == script_id
    assert listed.json()[0]["revision_count"] == 1

    first_finalized = client.post(f"/api/scripts/{script_id}/finalize")
    assert first_finalized.status_code == 200

    saved = client.patch(
        f"/api/scripts/{script_id}",
        json={
            "title": "雨夜新版",
            "content": "第一集\n场景一",
            "expected_checksum": original_revision["checksum"],
        },
    )
    assert saved.status_code == 200
    assert saved.json()["title"] == "雨夜新版"
    assert saved.json()["current_revision"]["content"] == "第一集\n场景一"

    second_finalized = client.post(f"/api/scripts/{script_id}/finalize")
    assert second_finalized.status_code == 200
    restored = client.post(
        f"/api/scripts/{script_id}/revisions/{original_revision['id']}/restore"
    )
    assert restored.status_code == 200
    assert restored.json()["current_revision"]["revision_number"] == 3
    assert restored.json()["current_revision"]["content"] == "第一集"

    history = client.get(f"/api/scripts/{script_id}/revisions")
    assert history.status_code == 200
    assert [item["revision_number"] for item in history.json()] == [3, 2, 1]

    deleted = client.delete(f"/api/scripts/{script_id}")
    assert deleted.status_code == 204
    assert client.get(f"/api/scripts/{script_id}").status_code == 404


def test_script_document_route_returns_revision_conflict(client):
    project = _project_via_api(client)
    created = client.post(
        f"/api/projects/{project['id']}/scripts",
        json={"title": "冲突", "source_type": "paste", "content": "初稿"},
    ).json()

    response = client.patch(
        f"/api/scripts/{created['id']}",
        json={"content": "过期内容", "expected_checksum": "stale"},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "revision_conflict"
    assert response.json()["detail"]["latest_checksum"] == created["current_revision"]["checksum"]


def test_script_upload_route_retains_original_file(client):
    project = _project_via_api(client)

    response = client.post(
        f"/api/projects/{project['id']}/scripts/upload",
        data={"title": "上传剧本"},
        files={"file": ("story.txt", "第一集：雨夜".encode(), "text/plain")},
    )

    assert response.status_code == 201
    revision = response.json()["current_revision"]
    assert revision["original_filename"] == "story.txt"
    assert revision["source_file_path"].endswith(".txt")
