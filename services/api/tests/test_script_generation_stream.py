import json


def _project(client):
    response = client.post(
        "/api/projects",
        json={
            "title": "雨夜",
            "logline": "追查芯片",
            "story_bible": "近未来重庆",
            "visual_style": "Chinese noir",
            "aspect_ratio": "9:16",
        },
    )
    assert response.status_code == 201
    return response.json()


def _events(body: str):
    events = []
    for frame in body.strip().split("\n\n"):
        lines = frame.splitlines()
        event = next(line[7:] for line in lines if line.startswith("event: "))
        data = json.loads(next(line[6:] for line in lines if line.startswith("data: ")))
        events.append((event, data))
    return events


def _script(client, project_id: str, content: str = ""):
    response = client.post(
        f"/api/projects/{project_id}/scripts",
        json={"title": "AI 剧本", "source_type": "ai", "content": content},
    )
    assert response.status_code == 201
    return response.json()


def test_streams_readable_script_chunks_with_trusted_project_context(client):
    captured = {}

    class Provider:
        async def stream_script(self, context):
            captured.update(context)
            yield "第一集：雨夜"
            yield "\n场景一"

    class Factory:
        def create_llm(self):
            return Provider()

    client.app.state.provider_factory = Factory()
    project = _project(client)

    response = client.post(
        f"/api/projects/{project['id']}/script-generation/stream",
        json={"brief": "生成三集", "existing_draft": ""},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert _events(response.text) == [
        ("chunk", {"text": "第一集：雨夜"}),
        ("chunk", {"text": "\n场景一"}),
        ("done", {"finish_reason": "stop"}),
    ]
    assert captured["brief"] == "生成三集"
    assert captured["existing_draft"] == ""
    assert captured["project"]["story_bible"] == "近未来重庆"


def test_stream_rejects_missing_project(client):
    response = client.post(
        "/api/projects/missing/script-generation/stream",
        json={"brief": "", "existing_draft": ""},
    )

    assert response.status_code == 404


def test_stream_returns_redacted_provider_error_event(client):
    class Provider:
        async def stream_script(self, context):
            yield "开头"
            raise RuntimeError("provider sk-secret-token failed")

    class Factory:
        def create_llm(self):
            return Provider()

    client.app.state.provider_factory = Factory()
    project = _project(client)

    response = client.post(
        f"/api/projects/{project['id']}/script-generation/stream",
        json={"brief": "", "existing_draft": ""},
    )

    assert response.status_code == 200
    assert _events(response.text)[-1] == (
        "error",
        {"message": "Script generation failed"},
    )
    assert "secret-token" not in response.text


def test_document_stream_persists_chunks_and_finalizes_revision(client):
    captured = {}

    class Provider:
        async def stream_script(self, context):
            captured.update(context)
            yield "第一集：雨夜"
            yield "\n场景一"

    class Factory:
        def create_llm(self):
            return Provider()

    client.app.state.provider_factory = Factory()
    project = _project(client)
    script = _script(client, project["id"])
    revision_id = script["current_revision"]["id"]

    response = client.post(
        f"/api/scripts/{script['id']}/generation/stream",
        json={"brief": "生成三集", "expected_revision_id": revision_id},
    )

    assert response.status_code == 200
    events = _events(response.text)
    assert [event for event, _ in events] == ["chunk", "chunk", "done"]
    assert events[0][1]["revision_id"] == revision_id
    assert events[1][1]["persisted_length"] == len("第一集：雨夜\n场景一")
    detail = client.get(f"/api/scripts/{script['id']}").json()
    assert detail["current_revision"]["content"] == "第一集：雨夜\n场景一"
    assert detail["current_revision"]["status"] == "finalized"
    assert detail["status"] == "ready"
    assert captured["brief"] == "生成三集"
    assert captured["existing_draft"] == ""


def test_document_stream_creates_a_clean_ai_version_after_a_finalized_version(client):
    class Provider:
        async def stream_script(self, context):
            assert context["existing_draft"] == ""
            yield "全新版本"

    class Factory:
        def create_llm(self):
            return Provider()

    client.app.state.provider_factory = Factory()
    project = _project(client)
    script = _script(client, project["id"], "旧版本正文")
    finalized = client.post(f"/api/scripts/{script['id']}/finalize").json()
    old_revision_id = finalized["current_revision"]["id"]

    response = client.post(
        f"/api/scripts/{script['id']}/generation/stream",
        json={"brief": "彻底重写", "expected_revision_id": old_revision_id},
    )

    assert response.status_code == 200
    events = _events(response.text)
    assert events[0][1]["revision_id"] != old_revision_id
    detail = client.get(f"/api/scripts/{script['id']}").json()
    assert detail["current_revision"]["revision_number"] == 2
    assert detail["current_revision"]["content"] == "全新版本"
    assert detail["current_revision"]["creation_method"] == "ai"
    assert detail["revision_count"] == 2


def test_document_stream_preserves_partial_text_after_provider_failure(client):
    class Provider:
        async def stream_script(self, context):
            yield "已保存开头"
            raise RuntimeError("provider sk-secret-value failed")

    class Factory:
        def create_llm(self):
            return Provider()

    client.app.state.provider_factory = Factory()
    project = _project(client)
    script = _script(client, project["id"])

    response = client.post(
        f"/api/scripts/{script['id']}/generation/stream",
        json={
            "brief": "",
            "expected_revision_id": script["current_revision"]["id"],
        },
    )

    assert _events(response.text)[-1] == (
        "error",
        {"message": "Script generation failed"},
    )
    detail = client.get(f"/api/scripts/{script['id']}").json()
    assert detail["current_revision"]["content"] == "已保存开头"
    assert detail["current_revision"]["status"] == "working"
    assert detail["status"] == "generation_failed"
    assert "secret-value" not in response.text


def test_document_stream_rejects_stale_revision(client):
    project = _project(client)
    script = _script(client, project["id"])

    response = client.post(
        f"/api/scripts/{script['id']}/generation/stream",
        json={"brief": "", "expected_revision_id": "stale"},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "revision_conflict"


def test_startup_recovery_marks_interrupted_generation_failed(client):
    project = _project(client)
    script = _script(client, project["id"], "部分内容")
    with client.app.state.session_factory() as session:
        from comic_studio import models

        document = session.get(models.ScriptDocument, script["id"])
        document.status = "generating"
        session.commit()

    recovered = client.app.state.recover_script_generations()

    assert recovered == [script["id"]]
    detail = client.get(f"/api/scripts/{script['id']}").json()
    assert detail["status"] == "generation_failed"
    assert detail["current_revision"]["content"] == "部分内容"
