from comic_studio import models, schemas
from comic_studio.services.episode_ai_runs import EpisodeAIRunConflict, EpisodeAIRunService


EXPECTED_STAGES = [
    "scripting",
    "structuring",
    "references",
    "panels",
    "panel_review",
    "speech",
    "videos",
    "rendering",
    "quality_review",
    "release_candidate",
    "release_gate",
    "published",
]


def _episode(client):
    project = client.post(
        "/api/projects",
        json={
            "title": "整集闭环",
            "logline": "AI 完成整集",
            "story_bible": "角色与空间连续",
            "visual_style": "modern comic",
            "aspect_ratio": "9:16",
        },
    ).json()
    return client.post(
        f"/api/projects/{project['id']}/episodes",
        json={
            "title": "第一集",
            "premise": "发现线索",
            "target_duration_seconds": 30,
        },
    ).json()


def test_episode_ai_run_api_persists_ordered_stages_and_is_idempotent(client):
    episode = _episode(client)
    payload = {
        "idempotency_key": "episode-v1",
        "automation_policy": {"approval_mode": "ai_default", "concurrency": 2},
    }

    first = client.post(f"/api/episodes/{episode['id']}/ai-runs", json=payload)
    second = client.post(f"/api/episodes/{episode['id']}/ai-runs", json=payload)

    assert first.status_code == 202
    assert second.status_code == 202
    body = first.json()
    assert second.json()["id"] == body["id"]
    assert body["status"] == "queued"
    assert body["current_stage"] == "references"
    assert [item["stage"] for item in body["stages"]] == EXPECTED_STAGES
    assert [item["status"] for item in body["stages"][:2]] == ["skipped", "skipped"]
    assert body["stages"][2]["status"] == "pending"
    assert body["automation_policy"]["approval_mode"] == "ai_default"
    assert client.get(f"/api/episodes/{episode['id']}/ai-runs/active").json()["id"] == body["id"]


def test_episode_ai_run_api_enforces_one_active_run_and_supports_controls(client):
    episode = _episode(client)
    created = client.post(
        f"/api/episodes/{episode['id']}/ai-runs",
        json={"idempotency_key": "first"},
    ).json()

    conflict = client.post(
        f"/api/episodes/{episode['id']}/ai-runs",
        json={"idempotency_key": "second"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == "Episode already has an active AI run"

    paused = client.post(f"/api/episode-ai-runs/{created['id']}/pause")
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"
    assert paused.json()["pause_requested"] is True

    continued = client.post(f"/api/episode-ai-runs/{created['id']}/continue")
    assert continued.status_code == 202
    assert continued.json()["status"] == "queued"
    assert continued.json()["pause_requested"] is False

    cancelled = client.post(f"/api/episode-ai-runs/{created['id']}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert client.get(f"/api/episodes/{episode['id']}/ai-runs/active").status_code == 404

    replacement = client.post(
        f"/api/episodes/{episode['id']}/ai-runs",
        json={"idempotency_key": "replacement"},
    )
    assert replacement.status_code == 202


def test_episode_ai_run_service_retries_review_block_without_losing_attempts(db_session):
    project = models.Project(
        title="恢复测试",
        logline="失败恢复",
        story_bible="连续",
        visual_style="comic",
        aspect_ratio="9:16",
        language="Chinese",
    )
    db_session.add(project)
    db_session.flush()
    episode = models.Episode(
        project_id=project.id,
        title="第一集",
        premise="恢复",
        target_duration_seconds=30,
    )
    db_session.add(episode)
    db_session.commit()
    service = EpisodeAIRunService(db_session)
    run, created = service.create(
        episode.id,
        schemas.EpisodeAIRunCreate(idempotency_key="retry-test"),
    )
    assert created is True

    running = service.start_current(run.id)
    assert running.status == "running"
    assert running.stages[2].status == "running"
    assert running.stages[2].attempt_count == 1

    blocked = service.fail_current(run.id, "reference mismatch", needs_review=True)
    assert blocked.status == "needs_review"
    assert blocked.stages[2].status == "needs_review"
    assert blocked.stages[2].error == "reference mismatch"

    retried = service.retry(run.id)
    assert retried.status == "queued"
    assert retried.stages[2].status == "pending"
    assert retried.stages[2].attempt_count == 1
    assert retried.stages[2].error == ""

    resumed = service.start_current(run.id)
    advanced = service.complete_current(resumed.id, {"reference_ids": ["ref-1"]})
    assert advanced.current_stage == "panels"
    assert advanced.stages[2].status == "succeeded"
    assert advanced.stages[2].output_metadata == {"reference_ids": ["ref-1"]}


def test_episode_ai_run_service_rejects_duplicate_active_run(db_session):
    project = models.Project(
        title="冲突测试",
        logline="冲突",
        story_bible="连续",
        visual_style="comic",
        aspect_ratio="9:16",
        language="Chinese",
    )
    db_session.add(project)
    db_session.flush()
    episode = models.Episode(
        project_id=project.id,
        title="第一集",
        premise="冲突",
        target_duration_seconds=30,
    )
    db_session.add(episode)
    db_session.commit()
    service = EpisodeAIRunService(db_session)
    service.create(episode.id, schemas.EpisodeAIRunCreate(idempotency_key="one"))

    try:
        service.create(episode.id, schemas.EpisodeAIRunCreate(idempotency_key="two"))
    except EpisodeAIRunConflict as exc:
        assert str(exc) == "active_run"
    else:
        raise AssertionError("Expected an active-run conflict")


def test_episode_ai_run_routes_schedule_create_continue_and_retry_once(client):
    episode = _episode(client)
    calls = []

    class FakeOrchestrator:
        async def run(self, run_id):
            calls.append(run_id)

    client.app.state.episode_ai_orchestrator = FakeOrchestrator()
    payload = {"idempotency_key": "scheduled-run"}

    created = client.post(f"/api/episodes/{episode['id']}/ai-runs", json=payload)
    repeated = client.post(f"/api/episodes/{episode['id']}/ai-runs", json=payload)
    run_id = created.json()["id"]
    assert created.status_code == 202
    assert repeated.status_code == 202
    assert calls == [run_id]

    assert client.post(f"/api/episode-ai-runs/{run_id}/pause").status_code == 200
    assert client.post(f"/api/episode-ai-runs/{run_id}/continue").status_code == 202
    assert calls == [run_id, run_id]

    with client.app.state.session_factory() as session:
        service = EpisodeAIRunService(session)
        service.start_current(run_id)
        service.fail_current(run_id, "temporary provider failure")
    assert client.post(f"/api/episode-ai-runs/{run_id}/retry").status_code == 202
    assert calls == [run_id, run_id, run_id]


def test_app_recovery_marks_interrupted_episode_ai_run_retryable(client):
    episode = _episode(client)
    with client.app.state.session_factory() as session:
        service = EpisodeAIRunService(session)
        run, _created = service.create(
            episode["id"],
            schemas.EpisodeAIRunCreate(idempotency_key="startup-recovery"),
        )
        service.start_current(run.id)

    recovered = client.app.state.recover_episode_ai_runs()

    assert recovered == [run.id]
    response = client.get(f"/api/episode-ai-runs/{run.id}")
    assert response.status_code == 200
    assert response.json()["status"] == "failed"
    assert response.json()["stages"][2]["output_metadata"] == {
        "error_code": "api_interrupted",
        "retryable": True,
    }
