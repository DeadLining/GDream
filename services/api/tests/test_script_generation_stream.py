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
