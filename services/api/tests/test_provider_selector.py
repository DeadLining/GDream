"""M4.2 — Provider 7-dimension scored selection.

Tests the scoring engine that ranks provider candidates using the recent
``model_invocations`` history. Integration with ``ModelRuntimeService`` is
also covered through ``_build_decision_log``.
"""

from __future__ import annotations

from types import SimpleNamespace

from pydantic import SecretStr

from comic_studio.model_runtime.adapters import ProviderRegistry
from comic_studio.model_runtime.contracts import Capability
from comic_studio.model_runtime.service import ModelRuntimeService
from comic_studio.provider_channels import ProviderChannel, ProviderChannels
from comic_studio.services.provider_selector import Candidate, ProviderSelector


class _FakeAdapter:
    def __init__(self, model: str = "fake-model"):
        self.model = model


def _make_invocation(session, *, capability, provider, model, status, elapsed_ms=0, cost_usd=0, retryable=False):
    from comic_studio import models

    invocation = models.ModelInvocation(
        capability=capability.value,
        provider=provider,
        model=model,
        target_type="shot",
        target_id="shot-1",
        status=status,
        elapsed_ms=elapsed_ms,
        cost_usd=cost_usd,
        retryable=retryable,
    )
    session.add(invocation)
    session.commit()
    return invocation


def test_selector_short_circuits_for_single_candidate(db_session):
    candidate = Candidate(provider="minimax", model="MiniMax-M3")
    result = ProviderSelector(db_session).select(Capability.TEXT, [candidate])

    assert result.reason == "single-registered-provider"
    assert result.selected.provider == "minimax"
    assert candidate.selected is True
    assert result.scores == {}


def test_selector_rejects_empty_candidates(db_session):
    try:
        ProviderSelector(db_session).select(Capability.TEXT, [])
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "at least one candidate" in str(exc)


def test_selector_scores_multiple_candidates_with_no_history(db_session):
    candidates = [
        Candidate(provider="minimax", model="m1"),
        Candidate(provider="openai", model="m2"),
    ]
    result = ProviderSelector(db_session).select(Capability.TEXT, candidates)

    assert result.reason == "scored-selection"
    assert result.selected in candidates
    assert set(result.scores.keys()) == {"minimax:m1", "openai:m2"}
    # With no history both candidates get the same neutral priors.
    assert result.totals["minimax:m1"] == result.totals["openai:m2"]


def test_selector_prefers_provider_with_better_success_rate(db_session):
    _make_invocation(
        db_session, capability=Capability.TEXT, provider="minimax", model="m1",
        status="succeeded", elapsed_ms=100, cost_usd=0.01,
    )
    _make_invocation(
        db_session, capability=Capability.TEXT, provider="openai", model="m2",
        status="failed", elapsed_ms=100, cost_usd=0.01,
    )

    result = ProviderSelector(db_session).select(
        Capability.TEXT,
        [
            Candidate(provider="minimax", model="m1"),
            Candidate(provider="openai", model="m2"),
        ],
    )

    assert result.selected.provider == "minimax"
    assert result.totals["minimax:m1"] > result.totals["openai:m2"]


def test_selector_prefers_provider_with_lower_cost_and_latency(db_session):
    _make_invocation(
        db_session, capability=Capability.IMAGE, provider="gptimage", model="m1",
        status="succeeded", elapsed_ms=5000, cost_usd=0.10,
    )
    _make_invocation(
        db_session, capability=Capability.IMAGE, provider="midjourney", model="m2",
        status="succeeded", elapsed_ms=500, cost_usd=0.02,
    )

    result = ProviderSelector(db_session).select(
        Capability.IMAGE,
        [
            Candidate(provider="gptimage", model="m1"),
            Candidate(provider="midjourney", model="m2"),
        ],
    )

    assert result.selected.provider == "midjourney"


def test_selector_penalizes_retryable_errors(db_session):
    _make_invocation(
        db_session, capability=Capability.TEXT, provider="a", model="m",
        status="succeeded", elapsed_ms=100, cost_usd=0.01,
    )
    _make_invocation(
        db_session, capability=Capability.TEXT, provider="b", model="m",
        status="failed", elapsed_ms=100, cost_usd=0.01, retryable=True,
    )

    result = ProviderSelector(db_session).select(
        Capability.TEXT,
        [Candidate(provider="a", model="m"), Candidate(provider="b", model="m")],
    )

    assert result.selected.provider == "a"
    assert result.scores["a:m"]["retry_rate"] > result.scores["b:m"]["retry_rate"]


def test_selector_health_and_enabled_dimensions(db_session):
    candidates = [
        Candidate(provider="a", model="m", health={"status": "healthy"}, channel={"enabled": True}),
        Candidate(provider="b", model="m", health={"status": "unavailable"}, channel={"enabled": True}),
        Candidate(provider="c", model="m", health={"status": "disabled"}, channel={"enabled": False}),
    ]
    result = ProviderSelector(db_session).select(Capability.TEXT, candidates)

    assert result.selected.provider == "a"
    assert result.scores["a:m"]["health_status"] == 1.0
    assert result.scores["b:m"]["health_status"] == 0.0
    assert result.scores["c:m"]["health_status"] == 0.5
    assert result.scores["c:m"]["enabled"] == 0.0


def test_selector_weights_are_normalized(db_session):
    weights = {"success_rate": 1.0, "latency": 1.0, "cost": 1.0}
    selector = ProviderSelector(db_session, weights=weights)
    assert abs(sum(selector.weights.values()) - 1.0) < 1e-9
    assert selector.weights["success_rate"] == 1 / 3


def test_build_decision_log_uses_scored_selection_for_multiple_candidates(db_session):
    """When the registry exposes multiple candidates, the decision log contains
    scores and the reason becomes ``scored-selection``."""
    registry = ProviderRegistry()
    registry.register(
        Capability.TEXT,
        type("MiniMaxProvider", (), {}),
        module_name="comic_studio.providers.minimax",
    )
    registry.register(
        Capability.TEXT,
        type("OpenAIProvider", (), {}),
        module_name="comic_studio.providers.openai",
    )

    adapters = SimpleNamespace(
        _adapter=_FakeAdapter("MiniMax-M3"),
        provider_factory=SimpleNamespace(_registry=registry),
    )
    adapters.create = lambda capability: adapters._adapter

    channels = ProviderChannels(
        llm=ProviderChannel(
            name="MiniMax",
            enabled=True,
            base_url="https://llm.example/v1",
            model="MiniMax-M3",
            api_key=SecretStr("secret"),
        ),
        image=ProviderChannel(
            name="GPT Image",
            enabled=True,
            base_url="https://image.example/v1",
            model="image-model",
            api_key=SecretStr("secret"),
        ),
        tts=ProviderChannel(
            name="Qwen TTS",
            enabled=True,
            base_url="https://tts.example/v1",
            model="tts-model",
            api_key=SecretStr("secret"),
        ),
    )
    store = SimpleNamespace(snapshot=channels)
    service = ModelRuntimeService(
        channel_store=store,
        session_factory=lambda: db_session,
        data_root="/tmp",
        adapters=adapters,
    )
    log = service._build_decision_log(
        Capability.TEXT, adapters.create(Capability.TEXT), store.snapshot.llm
    )

    assert log["reason"] == "scored-selection"
    assert "scores" in log
    assert "totals" in log
    assert len(log["candidates"]) == 2
    assert any(c["selected"] for c in log["candidates"])
