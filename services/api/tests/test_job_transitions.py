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


def test_failed_job_redacts_unquoted_composite_secrets_and_preserves_context(
    db_session,
):
    store = JobStore(db_session)
    job = store.create("plan_episode", "episode", "ep-2", {})
    store.transition(job.id, "running")
    error = (
        "Request failed api_key=raw-key, token: raw-token; "
        "access_token=access-value client_secret: client-value} retry available"
    )

    failed = store.transition(job.id, "failed", error=error)

    assert failed.error == (
        "Request failed api_key=[REDACTED], token: [REDACTED]; "
        "access_token=[REDACTED] client_secret: [REDACTED]} retry available"
    )
    assert all(
        secret not in failed.error
        for secret in ("raw-key", "raw-token", "access-value", "client-value")
    )


def test_failed_job_redacts_camel_case_and_nested_looking_secret_fields(db_session):
    store = JobStore(db_session)
    job = store.create("plan_episode", "episode", "ep-3", {})
    store.transition(job.id, "running")
    error = (
        'Request failed apiKey=api-secret; payload={"clientSecret":"client-secret",'
        '"nested":{"apiKey":"nested-secret","monkey":"visible"}}'
    )

    failed = store.transition(job.id, "failed", error=error)

    assert failed.error == (
        'Request failed apiKey=[REDACTED]; payload={"clientSecret":"[REDACTED]",'
        '"nested":{"apiKey":"[REDACTED]","monkey":"visible"}}'
    )
    assert all(
        secret not in failed.error
        for secret in ("api-secret", "client-secret", "nested-secret")
    )
