"""M4.2 — Provider 7-dimension scoring and selection.

Scores each provider candidate for a capability using the historical
``model_invocations`` table. The dimensions are intentionally orthogonal and
unitless so they can be weighted and compared across providers:

1. success_rate    — share of non-failed invocations in the lookback window.
2. latency         — lower average elapsed time is better.
3. cost            — lower average cost per invocation is better.
4. error_rate      — fewer hard failures is better.
5. retry_rate       — fewer retryable errors is better.
6. health_status   — last health-check result (healthy = 1, disabled = 0.5, unavailable = 0).
7. enabled         — whether the operator has enabled the channel.

The selector does not pick a provider at random: when only one candidate is
registered for a capability it short-circuits to ``single-registered-provider``.
When multiple candidates are available, the highest weighted score wins and the
full score breakdown is persisted in the invocation ``decision_log``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from comic_studio import models
from comic_studio.model_runtime.contracts import Capability


@dataclass
class Candidate:
    """A provider/model that can serve a capability."""

    provider: str
    model: str
    module: str = ""
    selected: bool = False
    channel: dict[str, Any] | None = None
    health: dict[str, Any] | None = None


@dataclass
class SelectionResult:
    """Outcome of a scored selection."""

    selected: Candidate
    scores: dict[str, dict[str, float]] = field(default_factory=dict)
    totals: dict[str, float] = field(default_factory=dict)
    reason: str = "single-registered-provider"


class ProviderSelector:
    """Score and select provider candidates from recent invocation history."""

    # Default weights for the seven scoring dimensions. They sum to 1.0.
    DEFAULT_WEIGHTS: dict[str, float] = {
        "success_rate": 0.25,
        "latency": 0.15,
        "cost": 0.20,
        "error_rate": 0.15,
        "retry_rate": 0.10,
        "health_status": 0.10,
        "enabled": 0.05,
    }

    # Lookback window for historical stats. Shorter windows react faster to
    # provider degradation; longer windows smooth out transient noise.
    DEFAULT_LOOKBACK_HOURS = 24

    # Latency normalization: avg_ms / LATENCY_DENOMINATOR_MS, so 10s = 0.0.
    LATENCY_DENOMINATOR_MS = 10_000.0

    # Cost normalization: avg_cost / COST_DENOMINATOR_USD, so $1.00 = 0.0.
    COST_DENOMINATOR_USD = 1.0

    def __init__(
        self,
        session: Session,
        *,
        lookback_hours: int = DEFAULT_LOOKBACK_HOURS,
        weights: dict[str, float] | None = None,
    ):
        self.session = session
        self.lookback_hours = lookback_hours
        if weights:
            # User-supplied weights are the full desired set; any default
            # dimensions not mentioned are treated as zero.
            self.weights = {**self.DEFAULT_WEIGHTS, **weights}
            for dimension in self.DEFAULT_WEIGHTS:
                if dimension not in weights:
                    self.weights[dimension] = 0.0
        else:
            self.weights = self.DEFAULT_WEIGHTS.copy()
        total = sum(self.weights.values())
        if total <= 0:
            raise ValueError("weights must sum to a positive value")
        if total != 1.0:
            self.weights = {k: v / total for k, v in self.weights.items()}

    @staticmethod
    def _candidate_key(candidate: Candidate) -> str:
        return f"{candidate.provider}:{candidate.model}"

    def _fetch_stats(
        self, capability: Capability, candidates: list[Candidate]
    ) -> dict[str, dict[str, Any]]:
        """Return recent invocation stats keyed by candidate key."""
        since = datetime.now(UTC) - timedelta(hours=self.lookback_hours)
        providers = [c.provider for c in candidates]
        stmt = (
            select(
                models.ModelInvocation.provider,
                models.ModelInvocation.model,
                func.count().label("total"),
                func.sum(
                    case((models.ModelInvocation.status == "succeeded", 1), else_=0)
                ).label("succeeded"),
                func.avg(models.ModelInvocation.elapsed_ms).label("avg_elapsed_ms"),
                func.avg(models.ModelInvocation.cost_usd).label("avg_cost_usd"),
                func.sum(
                    case((models.ModelInvocation.status == "failed", 1), else_=0)
                ).label("failed"),
                func.sum(
                    case(
                        (models.ModelInvocation.retryable.is_(True), 1),
                        else_=0,
                    )
                ).label("retryable"),
            )
            .where(
                models.ModelInvocation.capability == capability.value,
                models.ModelInvocation.provider.in_(providers),
                models.ModelInvocation.created_at >= since,
            )
            .group_by(models.ModelInvocation.provider, models.ModelInvocation.model)
        )
        stats: dict[str, dict[str, Any]] = {}
        for row in self.session.execute(stmt).all():
            key = f"{row.provider}:{row.model}"
            stats[key] = {
                "total": int(row.total or 0),
                "succeeded": int(row.succeeded or 0),
                "failed": int(row.failed or 0),
                "retryable": int(row.retryable or 0),
                "avg_elapsed_ms": float(row.avg_elapsed_ms or 0),
                "avg_cost_usd": float(row.avg_cost_usd or 0),
            }
        return stats

    @staticmethod
    def _health_score(health: dict[str, Any] | None) -> float:
        """Map a health payload to a 0-1 score."""
        if not health:
            return 0.5
        status = health.get("status")
        if status == "healthy":
            return 1.0
        if status == "disabled":
            return 0.5
        if status == "unavailable":
            return 0.0
        return 0.5

    def _score_candidate(
        self, candidate: Candidate, stats: dict[str, Any]
    ) -> tuple[dict[str, float], float]:
        """Return per-dimension scores and a weighted total for one candidate."""
        total = int(stats.get("total", 0))
        succeeded = int(stats.get("succeeded", 0))
        failed = int(stats.get("failed", 0))
        retryable = int(stats.get("retryable", 0))
        avg_elapsed_ms = float(stats.get("avg_elapsed_ms", 0))
        avg_cost_usd = float(stats.get("avg_cost_usd", 0))

        if total > 0:
            success_rate = succeeded / total
            error_rate = 1.0 - (failed / total)
            retry_rate = 1.0 - (retryable / total)
        else:
            # No history: neutral priors so new providers can compete.
            success_rate = 0.5
            error_rate = 0.5
            retry_rate = 0.5

        latency = max(0.0, 1.0 - avg_elapsed_ms / self.LATENCY_DENOMINATOR_MS)
        cost = max(0.0, 1.0 - avg_cost_usd / self.COST_DENOMINATOR_USD)

        health_status = self._health_score(candidate.health)
        enabled = 1.0 if (candidate.channel or {}).get("enabled", True) else 0.0

        score = {
            "success_rate": success_rate,
            "latency": latency,
            "cost": cost,
            "error_rate": error_rate,
            "retry_rate": retry_rate,
            "health_status": health_status,
            "enabled": enabled,
        }
        total_score = sum(score[d] * self.weights[d] for d in score)
        return score, total_score

    def select(self, capability: Capability, candidates: list[Candidate]) -> SelectionResult:
        """Score candidates and return the winner plus full score breakdown."""
        if not candidates:
            raise ValueError("at least one candidate is required")
        if len(candidates) == 1:
            candidates[0].selected = True
            return SelectionResult(
                selected=candidates[0],
                reason="single-registered-provider",
            )

        stats = self._fetch_stats(capability, candidates)
        scores: dict[str, dict[str, float]] = {}
        totals: dict[str, float] = {}

        for candidate in candidates:
            key = self._candidate_key(candidate)
            score, total = self._score_candidate(candidate, stats.get(key, {}))
            scores[key] = score
            totals[key] = total

        best_key = max(totals, key=totals.get)
        for candidate in candidates:
            candidate.selected = self._candidate_key(candidate) == best_key

        best = next(c for c in candidates if self._candidate_key(c) == best_key)
        return SelectionResult(
            selected=best,
            scores=scores,
            totals=totals,
            reason="scored-selection",
        )
