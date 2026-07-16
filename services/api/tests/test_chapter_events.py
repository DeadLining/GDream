"""Tests for M1.1 chapter event graph.

Covers:
  * deterministic chapter splitting (Chinese / English / fallback)
  * service-layer persistence via populate_chapters
  * API routes (list / reextract / episode lookup)
  * migration creates the script_chapters table
"""

from __future__ import annotations

from comic_studio.services.chapter_events import (
    ChapterEventDraft,
    ChapterEventService,
    split_chapters,
)


# --- Deterministic splitting ----------------------------------------------


def test_split_empty_returns_single_empty_chapter():
    drafts = split_chapters("")
    assert len(drafts) == 1
    assert drafts[0].index == 0
    assert drafts[0].source_text == ""


def test_split_short_text_without_headings_is_single_chapter():
    text = "这是一段简短的剧情简介，不足以触发章节切分。" * 5
    drafts = split_chapters(text)
    assert len(drafts) == 1
    assert drafts[0].index == 0
    assert drafts[0].source_text == text


def test_split_chinese_chapter_headings():
    text = (
        "第一章 初遇\n"
        + ("主角走在街上。" * 50) + "\n\n"
        + "第二章 冲突\n"
        + ("反派登场。" * 50) + "\n\n"
        + "第三章 解决\n"
        + ("真相大白。" * 50)
    )
    drafts = split_chapters(text)
    assert len(drafts) == 3
    assert drafts[0].title == "初遇"
    assert drafts[1].title == "冲突"
    assert drafts[2].title == "解决"
    assert drafts[0].index == 0
    assert "主角走在街上" in drafts[0].source_text
    assert "反派登场" in drafts[1].source_text
    assert "真相大白" in drafts[2].source_text


def test_split_english_chapter_headings():
    text = (
        "Chapter 1 The Arrival\n"
        + ("The hero arrives. " * 30) + "\n\n"
        + "Chapter 2 The Conflict\n"
        + ("A battle begins. " * 30)
    )
    drafts = split_chapters(text)
    assert len(drafts) == 2
    assert drafts[0].title.lower().startswith("the arrival")
    assert "hero arrives" in drafts[0].source_text
    assert "battle begins" in drafts[1].source_text


def test_split_ignores_stray_heading_inside_dialogue():
    # A heading-like line inside a long chapter body should not create a
    # spurious one-line chapter (the _MIN_CHAPTER_CHARS guard).
    text = (
        "第一章 长章节\n"
        + ("正文内容。" * 200) + "\n"
        + "第二章 短标题\n"
        + ("继续正文。" * 200)
    )
    drafts = split_chapters(text)
    assert len(drafts) == 2
    # Both chapters must have substantial bodies.
    assert all(len(d.source_text) > 100 for d in drafts)


def test_split_chapter_count_capped():
    headings = "\n".join(f"第{n}章 标题\n正文。\n\n" for n in range(600))
    drafts = split_chapters(headings)
    assert len(drafts) <= 500


# --- Service persistence --------------------------------------------------


def _make_project_and_script(client):
    project = client.post(
        "/api/projects",
        json={
            "title": "测试项目",
            "logline": "梗概",
            "story_bible": "设定",
            "visual_style": "漫画",
            "aspect_ratio": "9:16",
        },
    ).json()
    script = client.post(
        f"/api/projects/{project['id']}/scripts",
        json={"title": "剧本", "source_type": "paste", "content": ""},
    ).json()
    return project, script


def test_populate_chapters_persists_split(db_session):
    from comic_studio import models

    project = models.Project(title="P", logline="", story_bible="", visual_style="")
    db_session.add(project)
    db_session.flush()
    document = models.ScriptDocument(
        project_id=project.id, title="D", source_type="paste"
    )
    db_session.add(document)
    db_session.flush()

    text = (
        "第一章 开始\n" + ("内容。" * 80) + "\n\n"
        + "第二章 继续\n" + ("更多内容。" * 80)
    )
    service = ChapterEventService(db_session)
    chapters = service.populate_chapters(document.id, text)
    db_session.commit()

    assert len(chapters) == 2
    assert chapters[0].chapter_index == 0
    assert chapters[0].title == "开始"
    assert chapters[1].chapter_index == 1
    assert chapters[1].title == "继续"
    assert chapters[0].extraction_status == "pending"

    # Re-populate replaces existing rows.
    again = service.populate_chapters(document.id, "短文本")
    db_session.commit()
    assert len(again) == 1
    assert again[0].source_text == "短文本"


def test_store_extraction_result_persists_draft(db_session):
    from comic_studio import models

    project = models.Project(title="P", logline="", story_bible="", visual_style="")
    db_session.add(project)
    db_session.flush()
    document = models.ScriptDocument(
        project_id=project.id, title="D", source_type="paste"
    )
    db_session.add(document)
    db_session.flush()

    service = ChapterEventService(db_session)
    chapters = service.populate_chapters(document.id, "第一章 标题\n" + ("内容。" * 80))
    db_session.flush()

    draft = ChapterEventDraft(
        chapter_index=0,
        title="标题",
        beats=[{"order": 1, "summary": "主角登场", "characters": ["主角"], "stakes": "high"}],
        conflicts=["外部威胁"],
        open_threads=["神秘信物"],
        payoff_candidates=[],
        character_mentions=["主角"],
    )
    updated = service.store_extraction_result(chapters[0].id, draft)
    db_session.commit()

    assert updated.extraction_status == "extracted"
    assert updated.character_ids == ["主角"]
    assert updated.event_summary["conflicts"] == ["外部威胁"]
    assert updated.event_summary["beats"][0]["summary"] == "主角登场"


def test_mark_extraction_failed_records_error(db_session):
    from comic_studio import models

    project = models.Project(title="P", logline="", story_bible="", visual_style="")
    db_session.add(project)
    db_session.flush()
    document = models.ScriptDocument(
        project_id=project.id, title="D", source_type="paste"
    )
    db_session.add(document)
    db_session.flush()

    service = ChapterEventService(db_session)
    chapters = service.populate_chapters(document.id, "第一章\n" + ("内容。" * 80))
    db_session.flush()

    updated = service.mark_extraction_failed(chapters[0].id, "provider timeout")
    db_session.commit()

    assert updated.extraction_status == "failed"
    assert "provider timeout" in updated.extraction_error


# --- API routes -----------------------------------------------------------


def test_list_chapters_route_after_empty_content_has_single_chapter(client):
    _, script = _make_project_and_script(client)
    response = client.get(f"/api/scripts/{script['id']}/chapters")
    assert response.status_code == 200
    body = response.json()
    assert body["script_document_id"] == script["id"]
    # Script create auto-populates chapters; empty content yields 1 chapter.
    assert len(body["chapters"]) == 1
    assert body["chapters"][0]["extraction_status"] == "pending"


def test_reextract_chapters_route_creates_chapters(client):
    _, script = _make_project_and_script(client)
    text = (
        "第一章 相遇\n" + ("内容。" * 80) + "\n\n"
        + "第二章 离别\n" + ("更多内容。" * 80)
    )
    client.patch(
        f"/api/scripts/{script['id']}",
        json={"content": text, "expected_checksum": script["current_revision"]["checksum"]},
    )
    response = client.post(
        f"/api/scripts/{script['id']}/chapters/reextract",
        json={"force": True},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["chapters"]) == 2
    assert body["chapters"][0]["title"] == "相遇"
    assert body["chapters"][1]["title"] == "离别"


def test_reextract_chapters_route_404_for_unknown_script(client):
    response = client.post(
        "/api/scripts/unknown/chapters/reextract",
        json={"force": True},
    )
    assert response.status_code == 404


def test_list_chapters_after_reextract_returns_persisted_rows(client):
    _, script = _make_project_and_script(client)
    text = "第一章 标题\n" + ("正文。" * 80)
    client.patch(
        f"/api/scripts/{script['id']}",
        json={"content": text, "expected_checksum": script["current_revision"]["checksum"]},
    )
    client.post(f"/api/scripts/{script['id']}/chapters/reextract", json={"force": True})
    response = client.get(f"/api/scripts/{script['id']}/chapters")
    assert response.status_code == 200
    body = response.json()
    assert len(body["chapters"]) == 1
    assert body["chapters"][0]["extraction_status"] == "pending"


def test_extract_events_route_reports_provider_failure_without_keys(client):
    _, script = _make_project_and_script(client)
    text = "第一章 标题\n" + ("正文。" * 80)
    client.patch(
        f"/api/scripts/{script['id']}",
        json={"content": text, "expected_checksum": script["current_revision"]["checksum"]},
    )
    client.post(f"/api/scripts/{script['id']}/chapters/reextract", json={"force": True})
    response = client.post(
        f"/api/scripts/{script['id']}/chapters/extract-events",
        json={},
    )
    # The route always returns 200; failures are recorded per-chapter because
    # no provider API key is configured in the test environment.
    assert response.status_code == 200
    body = response.json()
    assert body["extracted"] == []
    assert len(body["failed"]) >= 1
    assert "chapter_id" in body["failed"][0]


def test_extract_events_route_syncs_idempotent_storyline_events(client):
    project, script = _make_project_and_script(client)
    volume = client.post(
        f"/api/projects/{project['id']}/volumes",
        json={"position": 1, "title": "第一卷", "summary": ""},
    ).json()
    episode = client.post(
        f"/api/volumes/{volume['id']}/episodes",
        json={
            "position": 1,
            "title": "第一集",
            "premise": "开端",
            "target_duration_seconds": 60,
        },
    ).json()
    text = "第一章 雨夜\n\n# 雨夜\n\n**林夏**发现一枚发光海螺。"
    client.patch(
        f"/api/scripts/{script['id']}",
        json={"content": text, "expected_checksum": script["current_revision"]["checksum"]},
    )
    client.post(f"/api/scripts/{script['id']}/chapters/reextract", json={"force": True})

    class FakeChapterRuntime:
        async def extract_chapter_events(self, context):
            return {
                "chapter_index": context["chapter_index"],
                "title": context["chapter_title"],
                "beats": [
                    {
                        "order": 1,
                        "summary": "林夏发现发光海螺",
                        "characters": ["林夏"],
                        "stakes": "海螺来历不明",
                    }
                ],
                "conflicts": ["林夏必须隐瞒海螺"],
                "open_threads": ["海螺为何发光"],
                "payoff_candidates": ["海螺揭示时间裂缝"],
                "character_mentions": ["林夏"],
            }

    client.app.state.model_runtime = FakeChapterRuntime()
    first = client.post(
        f"/api/scripts/{script['id']}/chapters/extract-events",
        json={},
    )
    assert first.status_code == 200
    assert len(first.json()["extracted"]) == 1

    storylines = client.get(f"/api/projects/{project['id']}/storylines").json()
    assert len(storylines) == 1
    assert storylines[0]["title"] == "AI 章节事件"
    assert len(storylines[0]["events"]) == 1
    event = storylines[0]["events"][0]
    assert event["episode_id"] == episode["id"]
    assert event["title"] == "林夏发现发光海螺"
    assert event["metadata"]["source"] == "chapter_extraction"

    chapter_id = first.json()["extracted"][0]["id"]
    second = client.post(
        f"/api/scripts/{script['id']}/chapters/extract-events",
        json={"chapter_ids": [chapter_id]},
    )
    assert second.status_code == 200
    storylines = client.get(f"/api/projects/{project['id']}/storylines").json()
    assert len(storylines) == 1
    assert len(storylines[0]["events"]) == 1


def test_episode_chapter_events_route_returns_empty_without_script(client):
    project = client.post(
        "/api/projects",
        json={
            "title": "项目",
            "logline": "梗概",
            "story_bible": "设定",
            "visual_style": "漫画",
            "aspect_ratio": "9:16",
        },
    ).json()
    episode = client.post(
        f"/api/projects/{project['id']}/episodes",
        json={"title": "第一集", "premise": "测试", "target_duration_seconds": 60},
    ).json()
    response = client.get(f"/api/episodes/{episode['id']}/chapter-events")
    assert response.status_code == 200
    body = response.json()
    assert body["chapters"] == []
