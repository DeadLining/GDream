from comic_studio import models
from tests.test_script_import_parsing import valid_draft


def _create_project(client):
    response = client.post(
        "/api/projects",
        json={
            "title": "雨夜失忆",
            "logline": "侦探追查记忆交易",
            "story_bible": "近未来重庆",
            "visual_style": "Chinese noir",
            "aspect_ratio": "9:16",
        },
    )
    assert response.status_code == 201
    return response.json()


def test_creates_pasted_script_import_without_mutating_project(client):
    project = _create_project(client)

    response = client.post(
        f"/api/projects/{project['id']}/script-imports",
        json={"mode": "auto", "text": "第一场\n林夏：别回头。"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "uploaded"
    assert body["source_format"] == "paste"
    assert body["extracted_text"].startswith("第一场")
    detail = client.get(f"/api/projects/{project['id']}").json()
    assert detail["characters"] == []
    assert detail["episodes"] == []


def test_creates_multipart_docx_import(client):
    project = _create_project(client)
    from tests.test_script_extraction import _docx_bytes

    response = client.post(
        f"/api/projects/{project['id']}/script-imports",
        data={"mode": "screenplay"},
        files={
            "file": (
                "episode.docx",
                _docx_bytes(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )

    assert response.status_code == 201
    assert response.json()["source_format"] == "docx"
    assert "别回头" in response.json()["extracted_text"]


def test_rejects_unknown_project_and_unsupported_content_type(client):
    missing = client.post(
        "/api/projects/missing/script-imports",
        json={"mode": "auto", "text": "剧本"},
    )
    project = _create_project(client)
    unsupported = client.post(
        f"/api/projects/{project['id']}/script-imports",
        content=b"raw",
        headers={"content-type": "application/octet-stream"},
    )

    assert missing.status_code == 404
    assert unsupported.status_code == 415


def test_patch_validates_and_preserves_strict_draft(client):
    project = _create_project(client)
    created = client.post(
        f"/api/projects/{project['id']}/script-imports",
        json={"mode": "auto", "text": "剧本"},
    ).json()

    response = client.patch(
        f"/api/script-imports/{created['id']}/draft",
        json={"project": {}, "characters": [], "episodes": []},
    )

    assert response.status_code == 422


def test_startup_recovery_marks_interrupted_imports_retryable(client):
    project = _create_project(client)
    with client.app.state.session_factory() as session:
        interrupted = models.ScriptImport(
            project_id=project["id"],
            status="parsing",
            mode="auto",
            source_format="paste",
            checksum="c" * 64,
            extracted_text="剧本",
        )
        session.add(interrupted)
        session.commit()
        import_id = interrupted.id

    recovered = client.app.state.recover_script_imports()

    assert import_id in recovered
    response = client.get(f"/api/script-imports/{import_id}")
    assert response.json()["status"] == "failed"
    assert response.json()["error_category"] == "interrupted"


def test_parse_and_retry_use_configured_llm_and_return_preview(client):
    class Planner:
        async def parse_script_import(self, context):
            return valid_draft()

    class Factory:
        def create_llm(self):
            return Planner()

    client.app.state.provider_factory = Factory()
    project = _create_project(client)
    created = client.post(
        f"/api/projects/{project['id']}/script-imports",
        json={"mode": "prose", "text": "雨夜，林夏发现一枚芯片。"},
    ).json()

    parsed = client.post(f"/api/script-imports/{created['id']}/parse")

    assert parsed.status_code == 200
    assert parsed.json()["status"] == "ready"
    assert parsed.json()["structured_draft"]["characters"][0]["name"] == "林夏"
    with client.app.state.session_factory() as session:
        script_import = session.get(models.ScriptImport, created["id"])
        script_import.status = "failed"
        session.commit()
    retried = client.post(f"/api/script-imports/{created['id']}/retry")
    assert retried.status_code == 200
    assert retried.json()["status"] == "ready"
