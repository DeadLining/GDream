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
