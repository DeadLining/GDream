from comic_studio.jobs import JobStore
from comic_studio.routes import jobs as jobs_routes


def failed_job(client, operation="generate_panel"):
    with client.app.state.session_factory() as session:
        store = JobStore(session)
        job = store.create(operation, "shot", "shot-1", {"activate": True})
        store.transition(job.id, "running")
        job = store.transition(
            job.id,
            "failed",
            error="provider timeout",
            result_metadata={"partial": True},
        )
        return job.id


def test_retry_requeues_failed_job_and_dispatches_original_operation(client, monkeypatch):
    job_id = failed_job(client)
    dispatched = []

    def fake_dispatch(app, retry_job_id, target_id):
        dispatched.append((retry_job_id, target_id))

    monkeypatch.setitem(
        jobs_routes.JOB_DISPATCHERS, "generate_panel", fake_dispatch
    )

    response = client.post(f"/api/jobs/{job_id}/retry")

    assert response.status_code == 202
    assert response.json()["status"] == "queued"
    assert response.json()["retry_count"] == 1
    assert response.json()["error"] == ""
    assert response.json()["result_metadata"] == {}
    assert dispatched == [(job_id, "shot-1")]


def test_retry_rejects_non_failed_and_unsupported_jobs(client):
    with client.app.state.session_factory() as session:
        queued = JobStore(session).create("generate_panel", "shot", "shot-1", {})
        queued_id = queued.id
    unsupported_id = failed_job(client, operation="unknown_operation")

    non_failed = client.post(f"/api/jobs/{queued_id}/retry")
    unsupported = client.post(f"/api/jobs/{unsupported_id}/retry")

    assert non_failed.status_code == 409
    assert unsupported.status_code == 422
