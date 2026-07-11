import pytest

from comic_studio.jobs import InvalidJobTransition, JobStore


def test_job_rejects_transition_from_succeeded_to_running(db_session):
    store = JobStore(db_session)
    job = store.create("plan_episode", "episode", "ep-1", {})

    store.transition(job.id, "running")
    store.transition(job.id, "succeeded")

    with pytest.raises(InvalidJobTransition):
        store.transition(job.id, "running")


def test_failed_job_can_be_requeued(db_session):
    store = JobStore(db_session)
    job = store.create("generate_panel", "shot", "shot-1", {})

    store.transition(job.id, "running")
    store.transition(job.id, "failed", error="provider timeout")
    retried = store.transition(job.id, "queued")

    assert retried.status == "queued"
    assert retried.retry_count == 1
    assert retried.error == ""


def test_failed_job_persists_recursively_redacted_readable_error(db_session):
    store = JobStore(db_session)
    job = store.create("plan_episode", "episode", "ep-1", {})
    store.transition(job.id, "running")
    secret = "raw-provider-secret"
    error = (
        'ProviderError: Authorization: Bearer bearer-secret; '
        f'payload={{"api_key":"{secret}","nested":{{"token":"nested-secret"}}}}'
    )

    failed = store.transition(job.id, "failed", error=error)

    assert failed.error.startswith("ProviderError:")
    assert "[REDACTED]" in failed.error
    assert "bearer-secret" not in failed.error
    assert secret not in failed.error
    assert "nested-secret" not in failed.error
