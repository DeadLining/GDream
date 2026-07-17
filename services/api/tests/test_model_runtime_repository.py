from comic_studio.jobs import JobStore
from comic_studio.model_runtime.contracts import Capability
from comic_studio.model_runtime.repository import InvocationRepository


def test_records_sanitized_terminal_invocation(db_session):
    repository = InvocationRepository(db_session)
    record = repository.start(
        Capability.TEXT, "minimax", "MiniMax-M3", "project", "p1"
    )

    finished = repository.finish(
        record.id, status="succeeded", elapsed_ms=1250
    )

    assert finished.capability == "text"
    assert finished.elapsed_ms == 1250
    assert finished.error_code == ""


def test_recovers_running_runtime_jobs_as_interrupted(db_session):
    store = JobStore(db_session)
    job = store.create(
        "runtime_image", "shot", "s1", {"capability": "image"}
    )
    store.transition(job.id, "running")
    invocation = InvocationRepository(db_session).start(
        Capability.IMAGE,
        "gptimage",
        "gpt-image-2",
        "shot",
        "s1",
        job.id,
    )

    recovered = InvocationRepository(db_session).recover_running_jobs()

    assert recovered == [job.id]
    interrupted = store.get(job.id)
    assert interrupted is not None
    assert interrupted.status == "failed"
    assert interrupted.result_metadata["error_code"] == "runtime_interrupted"
    assert interrupted.result_metadata["retryable"] is True
    db_session.refresh(invocation)
    assert invocation.status == "failed"
    assert invocation.error_code == "runtime_interrupted"
    assert invocation.retryable is True


def test_reconciles_legacy_running_invocation_for_terminal_job(db_session):
    store = JobStore(db_session)
    job = store.create(
        "runtime_image", "shot", "s1", {"capability": "image"}
    )
    store.transition(job.id, "running")
    invocation = InvocationRepository(db_session).start(
        Capability.IMAGE,
        "gptimage",
        "gpt-image-2",
        "shot",
        "s1",
        job.id,
    )
    store.interrupt_running(job.id)

    recovered = InvocationRepository(db_session).recover_running_jobs()

    assert recovered == []
    db_session.refresh(invocation)
    assert invocation.status == "failed"
    assert invocation.error_code == "runtime_interrupted"
    assert invocation.retryable is True
