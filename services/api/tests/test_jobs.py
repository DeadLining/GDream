from comic_studio.jobs import JobStore


def test_running_job_can_persist_batch_progress(db_session):
    store = JobStore(db_session)
    job = store.create(
        "runtime_image", "character", "c1", {"capability": "image"}
    )
    store.transition(job.id, "running", progress=5)

    updated = store.update_progress(
        job.id,
        progress=29,
        result_metadata={
            "current_type": "front",
            "completed_types": ["primary"],
        },
    )

    assert updated.status == "running"
    assert updated.progress == 29
    assert updated.result_metadata["completed_types"] == ["primary"]


def test_failed_batch_requeues_without_losing_completed_types(db_session):
    store = JobStore(db_session)
    job = store.create(
        "runtime_image", "character", "c1", {"capability": "image"}
    )
    store.transition(job.id, "running", progress=29)
    store.transition(
        job.id,
        "failed",
        error="provider timeout",
        result_metadata={
            "completed_types": ["primary"],
            "failed_type": "front",
        },
    )

    retried = store.requeue(job.id, preserve_result_metadata=True)

    assert retried.status == "queued"
    assert retried.retry_count == 1
    assert retried.result_metadata["completed_types"] == ["primary"]
    assert retried.error == ""
